import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { PrizeConfiguration } from '../prize/entities/prize-configuration.entity';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import { User } from '../users/entities/user.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import {
  AddToCartDto,
  UpdateCartItemDto,
  CartCheckoutDto,
  BundleOfferDto,
} from './dto/cart.dto';
import { WalletsService } from '../wallets/wallets.service';
import { PrizePurchaseOption } from '../prize/enums/prize-purchase-option.enum';
import {
  calculateBuyerItemFeeCents,
  calculateSellerFeeCents,
  getEffectiveSellerFeePercent,
  calculateRewardCadeCoinsFromCents,
  CADECOINS_PER_USD,
} from '../common/utils/fee-utils';
import { EmailsService } from '../emails/email.service';
import { CurrencyType } from '../enums/currency.enum';
import { TransactionType } from '../enums/transaction-type.enum';

const SHIPPING_FEE = 5;

interface SellerGroup {
  sellerId: string | null;
  sellerName: string;
  shopName: string;
  stripeAccountId: string | null;
  items: CartItem[];
  itemSubtotalCents: number;
  shippingCents: number;
  buyerFeeCents: number;
  sellerFeeCents: number;
  sellerFeePercent: number;
  totalCents: number;
}

interface CartSummary {
  cart: Cart;
  sellerGroups: SellerGroup[];
  cartTotals: {
    itemSubtotalCents: number;
    shippingCents: number;
    buyerFeeCents: number;
    totalCents: number;
    itemCount: number;
  };
  removedItems: Array<{
    id: string;
    name: string;
    reason: string;
  }>;
}

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);
  private stripe: Stripe;

  constructor(
    @InjectRepository(Cart)
    private cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private cartItemRepository: Repository<CartItem>,
    @InjectRepository(PrizeConfiguration)
    private prizeConfigRepository: Repository<PrizeConfiguration>,
    @InjectRepository(PrizeOrder)
    private prizeOrderRepository: Repository<PrizeOrder>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    private walletsService: WalletsService,
    private emailsService: EmailsService,
    private configService: ConfigService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY'),
    );
  }

  /**
   * Get or create a cart for a user
   */
  async getOrCreateCart(userId: string): Promise<Cart> {
    let cart = await this.cartRepository.findOne({
      where: { userId },
      relations: [
        'items',
        'items.prizeConfiguration',
        'items.prizeConfiguration.creator',
        'items.prizeConfiguration.itemImages',
      ],
    });

    if (!cart) {
      cart = this.cartRepository.create({ userId, items: [] });
      await this.cartRepository.save(cart);
    }

    return cart;
  }

  /**
   * Get cart with items grouped by seller, with pricing summary
   */
  async getCartSummary(userId: string): Promise<CartSummary> {
    const cart = await this.getOrCreateCart(userId);
    const removedItems: CartSummary['removedItems'] = [];

    // Validate stock and remove out-of-stock items
    const validItems: CartItem[] = [];
    for (const item of cart.items) {
      const prize = item.prizeConfiguration;
      if (!prize || !prize.isActive || prize.stock < item.quantity) {
        removedItems.push({
          id: item.id,
          name: prize?.name || 'Unknown item',
          reason:
            !prize || !prize.isActive
              ? 'Item is no longer available'
              : 'Item is out of stock',
        });
        await this.cartItemRepository.remove(item);
      } else {
        validItems.push(item);
      }
    }

    // Group by seller
    const groupMap = new Map<string, SellerGroup>();

    for (const item of validItems) {
      const sellerId = item.prizeConfiguration.createdBy;
      const key = sellerId || 'cardcade';

      if (!groupMap.has(key)) {
        let sellerName = 'CardCade';
        let shopName = "CardCade's Shop";
        let stripeAccountId: string | null = null;
        let sellerFeePercent = 0;

        if (sellerId) {
          const seller = await this.userRepository.findOne({
            where: { id: sellerId },
            relations: ['wallet'],
          });
          if (seller) {
            sellerName = seller.name || seller.username;
            shopName = seller.shopName || `${sellerName}'s Shop`;
            stripeAccountId = seller.stripeAccountId || null;
            sellerFeePercent = getEffectiveSellerFeePercent({
              lifetimeCadeCoins: Number(
                seller.wallet?.lifetimeCoinsEarned || 0,
              ),
              adminFeeOverridePercent:
                seller.adminFeeOverridePercent !== null &&
                seller.adminFeeOverridePercent !== undefined
                  ? Number(seller.adminFeeOverridePercent)
                  : null,
            });
          }
        }

        groupMap.set(key, {
          sellerId,
          sellerName,
          shopName,
          stripeAccountId,
          items: [],
          itemSubtotalCents: 0,
          shippingCents: SHIPPING_FEE * 100,
          buyerFeeCents: 0,
          sellerFeeCents: 0,
          sellerFeePercent,
          totalCents: 0,
        });
      }

      const group = groupMap.get(key);
      group.items.push(item);
      const itemCents = Math.round(
        (Number(item.prizeConfiguration.amount) / CADECOINS_PER_USD) *
          100 *
          item.quantity,
      );
      group.itemSubtotalCents += itemCents;
    }

    // Calculate fees for each group
    const sellerGroups: SellerGroup[] = [];
    for (const group of groupMap.values()) {
      // CardCade items: no buyer fee
      const isCardCade = group.sellerId === null;
      group.buyerFeeCents = isCardCade
        ? 0
        : calculateBuyerItemFeeCents(
            group.itemSubtotalCents + group.shippingCents,
            group.shippingCents,
          );
      group.sellerFeeCents = isCardCade
        ? 0
        : calculateSellerFeeCents(
            group.itemSubtotalCents,
            group.sellerFeePercent,
          );
      group.totalCents =
        group.itemSubtotalCents + group.shippingCents + group.buyerFeeCents;
      sellerGroups.push(group);
    }

    // Cart totals
    const cartTotals = {
      itemSubtotalCents: sellerGroups.reduce(
        (sum, g) => sum + g.itemSubtotalCents,
        0,
      ),
      shippingCents: sellerGroups.reduce(
        (sum, g) => sum + g.shippingCents,
        0,
      ),
      buyerFeeCents: sellerGroups.reduce(
        (sum, g) => sum + g.buyerFeeCents,
        0,
      ),
      totalCents: sellerGroups.reduce((sum, g) => sum + g.totalCents, 0),
      itemCount: validItems.reduce((sum, item) => sum + item.quantity, 0),
    };

    return { cart, sellerGroups, cartTotals, removedItems };
  }

  /**
   * Add item to cart
   */
  async addToCart(userId: string, dto: AddToCartDto): Promise<Cart> {
    const prize = await this.prizeConfigRepository.findOne({
      where: { id: dto.prizeConfigurationId },
    });

    if (!prize) {
      throw new NotFoundException('Item not found');
    }

    if (!prize.isActive) {
      throw new BadRequestException('Item is no longer available');
    }

    if (prize.stock < 1) {
      throw new BadRequestException('Item is out of stock');
    }

    const quantity = dto.quantity || 1;
    if (prize.stock < quantity) {
      throw new BadRequestException(
        `Only ${prize.stock} available in stock`,
      );
    }

    const cart = await this.getOrCreateCart(userId);

    // Check if item is already in cart
    const existingItem = cart.items.find(
      (item) => item.prizeConfigurationId === dto.prizeConfigurationId,
    );

    if (existingItem) {
      const newQty = existingItem.quantity + quantity;
      if (newQty > prize.stock) {
        throw new BadRequestException(
          `Cannot add more — only ${prize.stock} available (you have ${existingItem.quantity} in cart)`,
        );
      }
      existingItem.quantity = newQty;
      await this.cartItemRepository.save(existingItem);
    } else {
      const cartItem = this.cartItemRepository.create({
        cartId: cart.id,
        prizeConfigurationId: dto.prizeConfigurationId,
        quantity,
      });
      await this.cartItemRepository.save(cartItem);
    }

    return this.getOrCreateCart(userId);
  }

  /**
   * Update item quantity in cart
   */
  async updateCartItem(
    userId: string,
    cartItemId: string,
    dto: UpdateCartItemDto,
  ): Promise<Cart> {
    const cart = await this.getOrCreateCart(userId);
    const item = cart.items.find((i) => i.id === cartItemId);

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    const prize = await this.prizeConfigRepository.findOne({
      where: { id: item.prizeConfigurationId },
    });

    if (!prize || prize.stock < dto.quantity) {
      throw new BadRequestException(
        `Only ${prize?.stock || 0} available in stock`,
      );
    }

    item.quantity = dto.quantity;
    await this.cartItemRepository.save(item);

    return this.getOrCreateCart(userId);
  }

  /**
   * Remove item from cart
   */
  async removeCartItem(userId: string, cartItemId: string): Promise<Cart> {
    const cart = await this.getOrCreateCart(userId);
    const item = cart.items.find((i) => i.id === cartItemId);

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    await this.cartItemRepository.remove(item);
    return this.getOrCreateCart(userId);
  }

  /**
   * Empty entire cart
   */
  async clearCart(userId: string): Promise<Cart> {
    const cart = await this.getOrCreateCart(userId);
    if (cart.items.length > 0) {
      await this.cartItemRepository.remove(cart.items);
    }
    return this.getOrCreateCart(userId);
  }

  /**
   * Get the count of items in cart (for badge)
   */
  async getCartCount(userId: string): Promise<number> {
    const cart = await this.cartRepository.findOne({
      where: { userId },
      relations: ['items'],
    });
    if (!cart) return 0;
    return cart.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  /**
   * Checkout: validate stock, create orders, create Stripe session
   */
  async checkout(
    userId: string,
    dto: CartCheckoutDto,
  ): Promise<{
    stripeSessionUrl?: string;
    coinOnlyOrderIds?: string[];
    removedItems: CartSummary['removedItems'];
  }> {
    const summary = await this.getCartSummary(userId);

    if (summary.removedItems.length > 0 && summary.sellerGroups.length === 0) {
      throw new BadRequestException({
        message: 'All items in your cart are unavailable',
        removedItems: summary.removedItems,
      });
    }

    // Filter to only buy-eligible items (not offer-only)
    const buyableGroups: SellerGroup[] = [];
    for (const group of summary.sellerGroups) {
      const buyableItems = group.items.filter(
        (item) =>
          item.prizeConfiguration.purchaseOption !== PrizePurchaseOption.OFFERS_ONLY,
      );
      if (buyableItems.length > 0) {
        // Recalculate group with only buyable items
        const itemSubtotalCents = buyableItems.reduce(
          (sum, item) =>
            sum +
            Math.round(
              (Number(item.prizeConfiguration.amount) / CADECOINS_PER_USD) *
                100 *
                item.quantity,
            ),
          0,
        );
        const isCardCade = group.sellerId === null;
        const shippingCents = SHIPPING_FEE * 100;
        const buyerFeeCents = isCardCade
          ? 0
          : calculateBuyerItemFeeCents(
              itemSubtotalCents + shippingCents,
              shippingCents,
            );

        buyableGroups.push({
          ...group,
          items: buyableItems,
          itemSubtotalCents,
          shippingCents,
          buyerFeeCents,
          totalCents: itemSubtotalCents + shippingCents + buyerFeeCents,
        });
      }
    }

    if (buyableGroups.length === 0) {
      throw new BadRequestException(
        'No buyable items in cart. Offer-only items must be submitted as offers.',
      );
    }

    // Final stock validation
    for (const group of buyableGroups) {
      for (const item of group.items) {
        const freshPrize = await this.prizeConfigRepository.findOne({
          where: { id: item.prizeConfigurationId },
        });
        if (!freshPrize || freshPrize.stock < item.quantity) {
          throw new BadRequestException({
            message: `"${item.prizeConfiguration.name}" is no longer available in the requested quantity`,
            removedItems: [
              {
                id: item.id,
                name: item.prizeConfiguration.name,
                reason: 'Out of stock',
              },
            ],
          });
        }
      }
    }

    // Separate CardCade items (coin-eligible) from seller items (USD-only)
    const cardcadeGroup = buyableGroups.find((g) => g.sellerId === null);
    const sellerGroups = buyableGroups.filter((g) => g.sellerId !== null);

    const _user = await this.userRepository.findOne({ where: { id: userId } });
    const allOrderIds: string[] = [];
    const coinOnlyOrderIds: string[] = [];
    let needsStripeSession = sellerGroups.length > 0;

    // Handle CardCade items
    if (cardcadeGroup) {
      const paymentMethod = dto.cardcadePaymentMethod || 'usd';

      if (paymentMethod === 'coins') {
        // All-coins payment for CardCade items
        const totalCoins = Math.round(
          cardcadeGroup.itemSubtotalCents * (CADECOINS_PER_USD / 100),
        );
        const wallet = await this.walletRepository.findOne({
          where: { userId },
        });
        if (!wallet || Number(wallet.goldCoins) < totalCoins) {
          throw new BadRequestException('Insufficient coin balance');
        }

        // Create orders and deduct coins
        for (const item of cardcadeGroup.items) {
          const order = await this.createOrder(
            userId,
            item,
            dto.shippingAddress,
            'coins',
            Math.round(Number(item.prizeConfiguration.amount) * item.quantity),
            0,
          );
          order.status = 'paid';
          await this.prizeOrderRepository.save(order);
          coinOnlyOrderIds.push(order.id);

          // Decrement stock
          await this.prizeConfigRepository.decrement(
            { id: item.prizeConfigurationId },
            'stock',
            item.quantity,
          );
        }

        // Deduct coins
        await this.walletsService.updateBalance(
          userId,
          -totalCoins,
          CurrencyType.CADE_COINS,
          TransactionType.PURCHASE,
          `Cart purchase: ${cardcadeGroup.items.length} item(s) paid with CadeCoins`,
        );

        // Remove from cart
        await this.cartItemRepository.remove(cardcadeGroup.items);
      } else {
        // USD or combined — include in Stripe session
        needsStripeSession = true;
      }
    }

    if (!needsStripeSession) {
      // Everything was paid with coins
      // Update user address
      await this.userRepository.update(userId, {
        address: dto.shippingAddress.addressLine1,
        address2: dto.shippingAddress.addressLine2 || null,
        city: dto.shippingAddress.city,
        state: dto.shippingAddress.state,
        zipCode: dto.shippingAddress.zipCode,
        country: dto.shippingAddress.country,
      });

      return { coinOnlyOrderIds, removedItems: summary.removedItems };
    }

    // Build Stripe Checkout Session for USD items
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const cartOrderIds: string[] = [];
    const transferInstructions: Array<{
      orderId: string;
      sellerId: string;
      stripeAccountId: string;
      amountCents: number;
    }> = [];

    // Add seller group items
    for (const group of sellerGroups) {
      for (const item of group.items) {
        const _itemCents = Math.round(
          (Number(item.prizeConfiguration.amount) / CADECOINS_PER_USD) *
            100 *
            item.quantity,
        );
        const order = await this.createOrder(
          userId,
          item,
          dto.shippingAddress,
          'usd',
          0,
          (Number(item.prizeConfiguration.amount) / CADECOINS_PER_USD) *
            item.quantity,
        );
        cartOrderIds.push(order.id);
        allOrderIds.push(order.id);

        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: item.prizeConfiguration.name,
              ...(item.prizeConfiguration.imageUrl
                ? { images: [item.prizeConfiguration.imageUrl] }
                : {}),
            },
            unit_amount: Math.round(
              (Number(item.prizeConfiguration.amount) / CADECOINS_PER_USD) *
                100,
            ),
          },
          quantity: item.quantity,
        });
      }

      // Add shipping line item per seller
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Shipping — ${group.shopName}`,
          },
          unit_amount: group.shippingCents,
        },
        quantity: 1,
      });

      // Add buyer processing fee per seller group
      if (group.buyerFeeCents > 0) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Processing Fee`,
            },
            unit_amount: group.buyerFeeCents,
          },
          quantity: 1,
        });
      }

      // Calculate transfer to seller (items + shipping - seller fee)
      if (group.stripeAccountId) {
        const sellerTransferAmount =
          group.itemSubtotalCents +
          group.shippingCents -
          group.sellerFeeCents;

        transferInstructions.push({
          orderId: cartOrderIds[cartOrderIds.length - 1],
          sellerId: group.sellerId,
          stripeAccountId: group.stripeAccountId,
          amountCents: sellerTransferAmount,
        });
      }
    }

    // Add CardCade USD items if applicable
    if (
      cardcadeGroup &&
      (dto.cardcadePaymentMethod === 'usd' ||
        dto.cardcadePaymentMethod === 'combined' ||
        !dto.cardcadePaymentMethod)
    ) {
      for (const item of cardcadeGroup.items) {
        const order = await this.createOrder(
          userId,
          item,
          dto.shippingAddress,
          dto.cardcadePaymentMethod || 'usd',
          0,
          (Number(item.prizeConfiguration.amount) / CADECOINS_PER_USD) *
            item.quantity,
        );
        cartOrderIds.push(order.id);
        allOrderIds.push(order.id);

        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: item.prizeConfiguration.name,
              ...(item.prizeConfiguration.imageUrl
                ? { images: [item.prizeConfiguration.imageUrl] }
                : {}),
            },
            unit_amount: Math.round(
              (Number(item.prizeConfiguration.amount) / CADECOINS_PER_USD) *
                100,
            ),
          },
          quantity: item.quantity,
        });
      }

      // CardCade shipping
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Shipping — CardCade's Shop`,
          },
          unit_amount: cardcadeGroup.shippingCents,
        },
        quantity: 1,
      });
    }

    // Create Stripe session
    const clientUrl = this.configService.get<string>('CLIENT_URL');
    const stripeSession = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: `${clientUrl}/cart/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/cart`,
      metadata: {
        type: 'cart_checkout',
        userId,
        orderIds: cartOrderIds.join(','),
        transferInstructions: JSON.stringify(transferInstructions),
      },
      payment_intent_data: {
        metadata: {
          type: 'cart_checkout',
          userId,
          orderIds: cartOrderIds.join(','),
        },
      },
    });

    // Save stripe session ID on all orders
    for (const orderId of cartOrderIds) {
      await this.prizeOrderRepository.update(orderId, {
        stripeSessionId: stripeSession.id,
        status: 'buy_attempted',
      });
    }

    // Remove purchased items from cart
    const purchasedItemIds = buyableGroups.flatMap((g) =>
      g.items.map((i) => i.id),
    );
    await this.cartItemRepository.delete({ id: In(purchasedItemIds) });

    return {
      stripeSessionUrl: stripeSession.url,
      removedItems: summary.removedItems,
    };
  }

  /**
   * Handle successful cart checkout from webhook
   */
  async handleCheckoutSuccess(session: Stripe.Checkout.Session): Promise<void> {
    const metadata = session.metadata;
    if (!metadata || metadata.type !== 'cart_checkout') return;

    const orderIds = metadata.orderIds.split(',');
    const userId = metadata.userId;

    // Mark all orders as paid
    for (const orderId of orderIds) {
      const order = await this.prizeOrderRepository.findOne({
        where: { id: orderId },
        relations: ['prizeConfiguration'],
      });
      if (!order || order.status === 'paid') continue;

      order.status = 'paid';
      order.stripePaymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;
      await this.prizeOrderRepository.save(order);

      // Decrement stock
      await this.prizeConfigRepository.decrement(
        { id: order.prizeConfigurationId },
        'stock',
        order.coinsDeducted > 0 ? 1 : 1, // quantity is always per-order
      );
    }

    // Process transfers to sellers
    if (metadata.transferInstructions) {
      try {
        const transfers = JSON.parse(metadata.transferInstructions) as Array<{
          orderId: string;
          sellerId: string;
          stripeAccountId: string;
          amountCents: number;
        }>;
        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;

        for (const transfer of transfers) {
          try {
            const chargeId = paymentIntentId
              ? (await this.stripe.paymentIntents.retrieve(paymentIntentId)).latest_charge as string
              : undefined;
            await this.stripe.transfers.create({
              amount: transfer.amountCents,
              currency: 'usd',
              destination: transfer.stripeAccountId,
              source_transaction: chargeId,
              metadata: {
                orderId: transfer.orderId,
                sellerId: transfer.sellerId,
                type: 'cart_seller_payout',
              },
            });
          } catch (err) {
            this.logger.error(
              `Failed to transfer to seller ${transfer.sellerId}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `Failed to parse transfer instructions: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Award CadeCoins reward
    const totalCents = session.amount_total || 0;
    const rewardCoins = calculateRewardCadeCoinsFromCents(totalCents);
    if (rewardCoins > 0) {
      try {
        await this.walletsService.addCadeCoins(
          userId,
          rewardCoins,
          `CadeCoins reward for cart purchase`,
        );
      } catch (err) {
        this.logger.error(`Failed to award CadeCoins: ${err}`);
      }
    }

    // Update user shipping address
    const firstOrder = await this.prizeOrderRepository.findOne({
      where: { id: orderIds[0] },
    });
    if (firstOrder?.shippingAddress) {
      const addr = firstOrder.shippingAddress as {
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        state?: string;
        zipCode?: string;
        country?: string;
      };
      await this.userRepository.update(userId, {
        address: addr.addressLine1 || null,
        address2: addr.addressLine2 || null,
        city: addr.city || null,
        state: addr.state || null,
        zipCode: addr.zipCode || null,
        country: addr.country || null,
      });
    }
  }

  /**
   * Submit a bundle offer for items from the same seller
   */
  async submitBundleOffer(
    userId: string,
    dto: BundleOfferDto,
  ): Promise<PrizeOrder[]> {
    const cart = await this.getOrCreateCart(userId);

    // Validate all cart items exist and belong to user
    const items = cart.items.filter((item) =>
      dto.cartItemIds.includes(item.id),
    );
    if (items.length !== dto.cartItemIds.length) {
      throw new NotFoundException('One or more cart items not found');
    }

    // Validate all items are from the same seller
    const sellerIds = new Set(
      items.map((item) => item.prizeConfiguration.createdBy),
    );
    if (sellerIds.size > 1) {
      throw new BadRequestException(
        'Bundle offers can only include items from the same seller',
      );
    }

    const sellerId = items[0].prizeConfiguration.createdBy;
    if (!sellerId) {
      throw new BadRequestException(
        'Bundle offers cannot be made on CardCade items',
      );
    }

    // Validate all items accept offers
    for (const item of items) {
      if (
        item.prizeConfiguration.purchaseOption === PrizePurchaseOption.BUY_ONLY
      ) {
        throw new BadRequestException(
          `"${item.prizeConfiguration.name}" does not accept offers`,
        );
      }
    }

    // Validate stock
    for (const item of items) {
      const freshPrize = await this.prizeConfigRepository.findOne({
        where: { id: item.prizeConfigurationId },
      });
      if (!freshPrize || freshPrize.stock < item.quantity) {
        throw new BadRequestException(
          `"${item.prizeConfiguration.name}" is no longer available`,
        );
      }
    }

    // Create a bundle offer ID to link the orders
    const bundleOfferId = `bundle_${Date.now()}_${userId.slice(0, 8)}`;

    // Create one PrizeOrder per item, all linked by the same bundle ID
    const orders: PrizeOrder[] = [];
    for (const item of items) {
      const order = this.prizeOrderRepository.create({
        userId,
        prizeConfigurationId: item.prizeConfigurationId,
        shippingAddress: dto.shippingAddress,
        paymentMethod: 'usd',
        coinsDeducted: 0,
        usdCharged: 0,
        totalPrice:
          (dto.offerAmount / items.length) * item.quantity +
          (items.indexOf(item) === 0 ? SHIPPING_FEE : 0),
        offerAmount: dto.offerAmount,
        offerNotes: dto.offerNotes
          ? `[Bundle: ${bundleOfferId}] ${dto.offerNotes}`
          : `[Bundle: ${bundleOfferId}]`,
        status: 'offer_made',
      });
      const savedOrder = await this.prizeOrderRepository.save(order);
      orders.push(savedOrder);
    }

    // Remove items from cart
    await this.cartItemRepository.remove(items);

    // Send notification to seller
    const seller = await this.userRepository.findOne({
      where: { id: sellerId },
    });
    const buyer = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (seller?.email && buyer) {
      try {
        const itemNames = items
          .map((i) => i.prizeConfiguration.name)
          .join(', ');
        await this.emailsService.sendEmailSMTP(
          {
            toAddress: [seller.email],
            subject: 'New Bundle Offer Received',
            params: {
              buyerName: buyer.username,
              itemNames,
              offerAmount: dto.offerAmount.toFixed(2),
            },
          },
          'bundle-offer',
        );
      } catch (err) {
        this.logger.error(`Failed to send bundle offer email: ${err}`);
      }
    }

    return orders;
  }

  /**
   * Helper: Create a PrizeOrder from a cart item
   */
  private async createOrder(
    userId: string,
    item: CartItem,
    shippingAddress: CartCheckoutDto['shippingAddress'],
    paymentMethod: 'coins' | 'usd' | 'combined',
    coinsDeducted: number,
    usdCharged: number,
  ): Promise<PrizeOrder> {
    const totalPrice =
      (Number(item.prizeConfiguration.amount) / CADECOINS_PER_USD) *
        item.quantity +
      SHIPPING_FEE;

    const order = this.prizeOrderRepository.create({
      userId,
      prizeConfigurationId: item.prizeConfigurationId,
      shippingAddress,
      paymentMethod,
      coinsDeducted,
      usdCharged,
      totalPrice,
      status: 'pending',
    });

    return this.prizeOrderRepository.save(order);
  }
}
