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
import { MixpanelService } from '../integrations/mixpanel/mixpanel.service';
import { AnalyticsEvent } from '../integrations/mixpanel/analytics-events';
import { PrizePurchaseOption } from '../prize/enums/prize-purchase-option.enum';
import { PrizeSaleType } from '../prize/enums/prize-sale-type.enum';
import {
  calculateBuyerItemFeeCents,
  calculateSellerFeeCents,
  getBuyerFeePercentForStripeMethod,
  getEffectiveSellerFeePercent,
  calculateRewardCadeCoinsFromCents,
  CADECOINS_PER_USD,
} from '../common/utils/fee-utils';
import { EmailsService } from '../emails/email.service';
import { PurchaseNotificationsService } from '../emails/purchase-notifications.service';
import { CurrencyType } from '../enums/currency.enum';
import { TransactionType } from '../enums/transaction-type.enum';
import {
  PromoCodeService,
  DiscountValidationResult,
} from '../promo-code/promo-code.service';

const SHIPPING_FEE = 5;

/** Resolve a relative image path to a full S3 URL for Stripe.
 *  Returns null for any value that cannot form a valid absolute URL
 *  so Stripe never receives a malformed images[] entry. */
const resolveImageUrl = (
  imageUrl: string | null | undefined,
): string | null => {
  if (!imageUrl || !imageUrl.trim()) return null;
  const raw = imageUrl.startsWith('http')
    ? imageUrl
    : `https://streambets3prod.s3.us-east-1.amazonaws.com/${encodeURI(imageUrl)}`;
  try {
    new URL(raw); // validate
    return raw;
  } catch {
    return null; // skip invalid URLs rather than breaking the Stripe call
  }
};

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
    private purchaseNotifications: PurchaseNotificationsService,
    private configService: ConfigService,
    private promoCodeService: PromoCodeService,
    private mixpanel: MixpanelService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY'),
    );
  }

  /**
   * Emit settled-revenue analytics for a completed cart checkout: one
   * cart-level "Purchase Completed" event, a Mixpanel revenue charge, and a
   * buyer profile refresh. Fires for card at checkout, and for ACH only once
   * the debit settles — so Mixpanel revenue tracks settled money. Best-effort.
   */
  private trackCartPurchase(params: {
    userId: string;
    buyer: User | null;
    itemCount: number;
    amountCents: number;
    paymentMethod: 'card' | 'ach';
    stripeSessionId: string;
  }): void {
    const amountUsd = (params.amountCents || 0) / 100;
    this.mixpanel.track(AnalyticsEvent.PURCHASE_COMPLETED, params.userId, {
      orderType: 'cart',
      itemCount: params.itemCount,
      amountUsd,
      paymentMethod: params.paymentMethod,
      stripeSessionId: params.stripeSessionId,
    });
    this.mixpanel.trackCharge(params.userId, amountUsd, {
      orderType: 'cart',
      paymentMethod: params.paymentMethod,
    });
    if (params.buyer) {
      this.mixpanel.setPeople(params.userId, {
        $email: params.buyer.email,
        username: params.buyer.username,
        lastPurchaseAt: new Date().toISOString(),
      });
    }
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
          // Per-item shipping accumulates below from each
          // prize.shippingCostUsd. Defaults to $5 when the column is
          // null (legacy rows) and 0 means Free Shipping.
          shippingCents: 0,
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
      // In-person pickup no longer forces shipping to $0 — sellers may
      // still charge a hand-off / delivery fee, so we honor whatever
      // shippingCostUsd the seller saved on the prize. The isInPerson
      // flag only affects whether we collect a shipping address.
      const perItemShippingUsd =
        item.prizeConfiguration.shippingCostUsd != null
          ? Number(item.prizeConfiguration.shippingCostUsd)
          : SHIPPING_FEE;
      group.shippingCents += Math.round(perItemShippingUsd * 100) * item.quantity;
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
      shippingCents: sellerGroups.reduce((sum, g) => sum + g.shippingCents, 0),
      buyerFeeCents: sellerGroups.reduce((sum, g) => sum + g.buyerFeeCents, 0),
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
    if (prize.saleType === PrizeSaleType.AUCTION) {
      throw new BadRequestException(
        'Auction items must be won via bidding and cannot be added to the cart.',
      );
    }

    if (prize.stock < 1) {
      throw new BadRequestException('Item is out of stock');
    }

    const quantity = dto.quantity || 1;
    if (prize.stock < quantity) {
      throw new BadRequestException(`Only ${prize.stock} available in stock`);
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
          `Cannot add more â€” only ${prize.stock} available (you have ${existingItem.quantity} in cart)`,
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
   * Validate a discount code for a given user.
   * Delegates to PromoCodeService.validateForCart.
   */
  async validateDiscountCode(
    userId: string,
    code: string,
  ): Promise<DiscountValidationResult> {
    return this.promoCodeService.validateForCart(code, userId);
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

    // Shared id linking every order created in this checkout, so the admin
    // Orders view can group a multi-item cart as one purchase.
    const cartGroupId = `cart_${Date.now()}_${userId.slice(0, 8)}`;

    if (summary.removedItems.length > 0 && summary.sellerGroups.length === 0) {
      throw new BadRequestException({
        message: 'All items in your cart are unavailable',
        removedItems: summary.removedItems,
      });
    }

    // Cancel any stale buy_attempted orders from previous abandoned checkouts
    const staleOrders = await this.prizeOrderRepository.find({
      where: { userId, status: 'buy_attempted' },
    });
    if (staleOrders.length > 0) {
      for (const stale of staleOrders) {
        stale.status = 'cancelled';
        await this.prizeOrderRepository.save(stale);
      }
      this.logger.log(
        `Cancelled ${staleOrders.length} stale buy_attempted order(s) for user ${userId}`,
      );
    }

    // Validate discount code if provided
    let discountValidation: DiscountValidationResult | null = null;
    if (dto.discountCode) {
      discountValidation = await this.promoCodeService.validateForCart(
        dto.discountCode,
        userId,
      );
      if (!discountValidation.valid) {
        throw new BadRequestException(discountValidation.message);
      }
    }

    // Filter to only buy-eligible items (not offer-only)
    const buyableGroups: SellerGroup[] = [];
    for (const group of summary.sellerGroups) {
      const buyableItems = group.items.filter(
        (item) =>
          item.prizeConfiguration.purchaseOption !==
          PrizePurchaseOption.OFFERS_ONLY,
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
        // Per-item shipping: sum each prize’s shippingCostUsd (default $5
        // for legacy rows; 0 = Free Shipping). In-person items still
        // honor the seller-configured shipping fee — only address
        // collection is skipped on the storefront.
        const shippingCents = buyableItems.reduce((sum, item) => {
          const perItemShippingUsd =
            item.prizeConfiguration.shippingCostUsd != null
              ? Number(item.prizeConfiguration.shippingCostUsd)
              : SHIPPING_FEE;
          return sum + Math.round(perItemShippingUsd * 100) * item.quantity;
        }, 0);
        // Buyer fee rate depends on the chosen Stripe payment method.
        // For seller items (everything except the CardCade group) we
        // use the rate the buyer locked in for this checkout. CardCade
        // items charge no buyer fee.
        const checkoutBuyerFeePercent = getBuyerFeePercentForStripeMethod(
          dto.stripePaymentMethod,
        );
        const buyerFeeCents = isCardCade
          ? 0
          : calculateBuyerItemFeeCents(
              itemSubtotalCents + shippingCents,
              shippingCents,
              checkoutBuyerFeePercent,
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

        // Buyer for the purchase-confirmation emails (looked up once).
        const coinBuyer = await this.userRepository.findOne({
          where: { id: userId },
        });

        // Create orders and deduct coins
        for (const item of cardcadeGroup.items) {
          const order = await this.createOrder(
            userId,
            item,
            dto.shippingAddress,
            'coins',
            Math.round(Number(item.prizeConfiguration.amount) * item.quantity),
            0,
            cartGroupId,
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

          // Coin purchases settle instantly — notify seller (safe to ship)
          // and buyer. isPaymentProcessing is always false here.
          if (item.prizeConfiguration && coinBuyer) {
            await this.purchaseNotifications.sendSellerShopPurchaseNotification(
              order,
              item.prizeConfiguration,
              coinBuyer,
              { isPaymentProcessing: false },
            );
            await this.purchaseNotifications.sendBuyerShopPurchaseNotification(
              order,
              item.prizeConfiguration,
              coinBuyer,
              { isPaymentProcessing: false },
            );
          }
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
        // USD or combined â€” include in Stripe session
        needsStripeSession = true;
      }
    }

    if (!needsStripeSession) {
      // Everything was paid with coins
      // Update user address
      await this.userRepository.update(userId, {
        firstName: dto.shippingAddress.firstName || null,
        lastName: dto.shippingAddress.lastName || null,
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
          cartGroupId,
        );
        cartOrderIds.push(order.id);
        allOrderIds.push(order.id);

        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${group.shopName} â€” ${item.prizeConfiguration.name}`,
              ...(resolveImageUrl(item.prizeConfiguration.imageUrl)
                ? {
                    images: [resolveImageUrl(item.prizeConfiguration.imageUrl)],
                  }
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
            name: `Shipping â€” ${group.shopName}`,
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
          group.itemSubtotalCents + group.shippingCents - group.sellerFeeCents;

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
          cartGroupId,
        );
        cartOrderIds.push(order.id);
        allOrderIds.push(order.id);

        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: `CardCade's Shop â€” ${item.prizeConfiguration.name}`,
              ...(resolveImageUrl(item.prizeConfiguration.imageUrl)
                ? {
                    images: [resolveImageUrl(item.prizeConfiguration.imageUrl)],
                  }
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
            name: `Shipping â€” CardCade's Shop`,
          },
          unit_amount: cardcadeGroup.shippingCents,
        },
        quantity: 1,
      });
    }

    // Create Stripe session
    const clientUrl =
      this.configService.get<string>('CLIENT_URL') ||
      this.configService.get<string>('app.clientUrl') ||
      'http://localhost:8080';
    const successUrl = `${clientUrl}/cart/checkout-success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${clientUrl}/cart`;

    // Create a one-time Stripe coupon if a discount code was validated
    let stripeCouponId: string | undefined;
    let discountCents = 0;
    if (discountValidation?.valid) {
      const itemSubtotalCents = buyableGroups.reduce(
        (sum, g) => sum + g.itemSubtotalCents,
        0,
      );

      // Find the cheapest individual item across all buyable groups
      let cheapestItemCents: number | undefined;
      for (const group of buyableGroups) {
        for (const item of group.items) {
          const unitPriceCents = Math.round(
            (Number(item.prizeConfiguration.amount) / CADECOINS_PER_USD) * 100,
          );
          if (
            cheapestItemCents === undefined ||
            unitPriceCents < cheapestItemCents
          ) {
            cheapestItemCents = unitPriceCents;
          }
        }
      }

      discountCents = this.promoCodeService.calculateDiscountCents(
        discountValidation,
        itemSubtotalCents,
        cheapestItemCents,
      );
      if (discountCents > 0) {
        const couponParams: Stripe.CouponCreateParams = {
          duration: 'once',
          name: `Discount ${discountValidation.code}`,
        };
        // For cheapest_item scope or fixed_amount, always use amount_off
        // so Stripe deducts the exact pre-computed amount.
        // percent_off only makes sense for whole-cart percent codes.
        if (
          discountValidation.discountType === 'percent' &&
          discountValidation.scope !== 'cheapest_item'
        ) {
          couponParams.percent_off = discountValidation.discountPercent;
        } else {
          couponParams.amount_off = discountCents;
          couponParams.currency = 'usd';
        }
        const stripeCoupon = await this.stripe.coupons.create(couponParams);
        stripeCouponId = stripeCoupon.id;
      }
    }

    let stripeSession: Stripe.Checkout.Session;
    try {
      // If we got this far we always have USD items to charge — the
      // all-coins branch early-returned above. Require & restrict the
      // hosted Checkout to the single payment method the buyer chose
      // so the fee tier they were quoted matches what Stripe actually
      // charges (and a tampered client can't pay 0.8% by card).
      if (
        dto.stripePaymentMethod !== 'card' &&
        dto.stripePaymentMethod !== 'us_bank_account'
      ) {
        throw new BadRequestException(
          'stripePaymentMethod ("card" or "us_bank_account") is required when the cart contains USD items.',
        );
      }
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        payment_method_types: [
          dto.stripePaymentMethod,
        ] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          type: 'cart_checkout',
          userId,
          orderIds: cartOrderIds.join(','),
          transferInstructions: JSON.stringify(transferInstructions),
          ...(discountValidation?.discountCodeId && {
            discountCodeId: discountValidation.discountCodeId,
            discountCents: String(discountCents),
          }),
        },
        payment_intent_data: {
          metadata: {
            type: 'cart_checkout',
            userId,
            orderIds: cartOrderIds.join(','),
          },
        },
      };
      if (stripeCouponId) {
        sessionParams.discounts = [{ coupon: stripeCouponId }];
      }
      stripeSession = await this.stripe.checkout.sessions.create(sessionParams);
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : 'Unknown Stripe error';
      const errStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `Stripe checkout session creation failed: ${errMsg}`,
        errStack,
      );
      this.logger.error(
        `Stripe params â€” success_url: ${successUrl}, cancel_url: ${cancelUrl}, ` +
          `line_items count: ${lineItems.length}`,
      );
      // Clean up created orders since payment session failed
      for (const orderId of cartOrderIds) {
        await this.prizeOrderRepository.delete(orderId);
      }
      throw new BadRequestException(`Payment session failed: ${errMsg}`);
    }

    // Save stripe session ID on all orders
    for (const orderId of cartOrderIds) {
      await this.prizeOrderRepository.update(orderId, {
        stripeSessionId: stripeSession.id,
        stripePaymentMethod: dto.stripePaymentMethod,
        status: 'buy_attempted',
      });
    }

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
    // ACH leaves session.payment_status='unpaid' or 'processing' until
    // funds clear (3–5 business days). We finalize seller transfers and
    // CadeCoin rewards only after payment_intent.succeeded fires.
    const isPaymentProcessing = session.payment_status !== 'paid';
    const orderStatus: 'paid' | 'payment_processing' = isPaymentProcessing
      ? 'payment_processing'
      : 'paid';

    // Buyer for the purchase-confirmation emails (looked up once).
    const buyer = await this.userRepository.findOne({ where: { id: userId } });

    // Mark all orders
    for (const orderId of orderIds) {
      const order = await this.prizeOrderRepository.findOne({
        where: { id: orderId },
        relations: ['prizeConfiguration'],
      });
      if (
        !order ||
        order.status === 'paid' ||
        order.status === 'payment_processing'
      ) {
        continue;
      }

      order.status = orderStatus;
      order.stripePaymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;
      await this.prizeOrderRepository.save(order);

      // Decrement stock immediately so the item is reserved even while
      // ACH is settling — it will be restored if ACH fails.
      await this.prizeConfigRepository.decrement(
        { id: order.prizeConfigurationId },
        'stock',
        order.coinsDeducted > 0 ? 1 : 1, // quantity is always per-order
      );

      // Notify seller + buyer of the purchase. For ACH (isPaymentProcessing)
      // the seller email carries a DO-NOT-SHIP banner; the "safe to ship"
      // email is sent later from handleCartAchSettled once funds clear.
      if (order.prizeConfiguration && buyer) {
        await this.purchaseNotifications.sendSellerShopPurchaseNotification(
          order,
          order.prizeConfiguration,
          buyer,
          { isPaymentProcessing },
        );
        await this.purchaseNotifications.sendBuyerShopPurchaseNotification(
          order,
          order.prizeConfiguration,
          buyer,
          { isPaymentProcessing },
        );
      }
    }

    // Record discount code redemption if one was applied
    if (metadata.discountCodeId) {
      try {
        const discountCents = parseInt(metadata.discountCents || '0', 10);
        await this.promoCodeService.recordRedemption(
          metadata.discountCodeId,
          userId,
          discountCents,
          session.id,
        );
        this.logger.log(
          `Recorded discount code redemption: code=${metadata.discountCodeId}, user=${userId}, discount=${discountCents}c`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to record discount code redemption: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Remove purchased items from the user's cart now that payment is confirmed
    try {
      const cart = await this.cartRepository.findOne({
        where: { userId },
        relations: ['items'],
      });
      if (cart) {
        const paidPrizeConfigIds = orderIds.length
          ? (
              await this.prizeOrderRepository.find({
                where: { id: In(orderIds) },
                select: ['prizeConfigurationId'],
              })
            ).map((o) => o.prizeConfigurationId)
          : [];
        const itemsToRemove = cart.items.filter((ci) =>
          paidPrizeConfigIds.includes(ci.prizeConfigurationId),
        );
        if (itemsToRemove.length > 0) {
          await this.cartItemRepository.remove(itemsToRemove);
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to remove cart items after payment: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Process transfers to sellers — only when funds have actually
    // settled. For ACH, transfers are deferred until
    // handleCartAchSettled() is called from payment_intent.succeeded.
    if (metadata.transferInstructions && !isPaymentProcessing) {
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
              ? ((await this.stripe.paymentIntents.retrieve(paymentIntentId))
                  .latest_charge as string)
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

    // Award CadeCoins reward — only after settlement so an ACH failure
    // doesn't leave the buyer with free reward coins.
    const totalCents = session.amount_total || 0;
    const rewardCoins = calculateRewardCadeCoinsFromCents(totalCents);
    if (rewardCoins > 0 && !isPaymentProcessing) {
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
        firstName?: string;
        lastName?: string;
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        state?: string;
        zipCode?: string;
        country?: string;
      };
      await this.userRepository.update(userId, {
        firstName: addr.firstName || null,
        lastName: addr.lastName || null,
        address: addr.addressLine1 || null,
        address2: addr.addressLine2 || null,
        city: addr.city || null,
        state: addr.state || null,
        zipCode: addr.zipCode || null,
        country: addr.country || null,
      });
    }

    // Analytics: card carts are real revenue now. ACH carts are tracked on
    // settle (handleCartAchSettled) so Mixpanel revenue matches settled money.
    if (!isPaymentProcessing) {
      this.trackCartPurchase({
        userId,
        buyer,
        itemCount: orderIds.length,
        amountCents: session.amount_total || 0,
        paymentMethod: 'card',
        stripeSessionId: session.id,
      });
    }
  }

  /**
   * Called from payments.service.ts:handlePaymentIntentSucceeded when an
   * ACH cart-checkout payment finally settles. Flips orders from
   * payment_processing → paid, runs deferred seller transfers, awards
   * CadeCoins, and emits seller "safe to ship" notifications.
   */
  async handleCartAchSettled(stripeSessionId: string): Promise<void> {
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.retrieve(stripeSessionId);
    } catch (err) {
      this.logger.error(
        `handleCartAchSettled: failed to retrieve session ${stripeSessionId}: ${err}`,
      );
      return;
    }

    const metadata = session.metadata;
    if (!metadata || metadata.type !== 'cart_checkout') return;

    const orderIds = metadata.orderIds.split(',');
    const userId = metadata.userId;

    // Buyer for the settled notification (looked up once).
    const buyer = await this.userRepository.findOne({ where: { id: userId } });

    // Flip orders to paid
    for (const orderId of orderIds) {
      const order = await this.prizeOrderRepository.findOne({
        where: { id: orderId },
        relations: ['prizeConfiguration'],
      });
      if (!order || order.status !== 'payment_processing') continue;
      order.status = 'paid';
      await this.prizeOrderRepository.save(order);

      // ACH has now cleared — tell the seller it's safe to ship.
      if (order.prizeConfiguration && buyer) {
        await this.purchaseNotifications.sendSellerPaymentSettledNotification(
          order,
          order.prizeConfiguration,
          buyer,
        );
      }
    }

    // Deferred seller transfers
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
              ? ((await this.stripe.paymentIntents.retrieve(paymentIntentId))
                  .latest_charge as string)
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
              `Failed deferred transfer to seller ${transfer.sellerId}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `Failed to parse deferred transfer instructions: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Deferred CadeCoins reward
    const totalCents = session.amount_total || 0;
    const rewardCoins = calculateRewardCadeCoinsFromCents(totalCents);
    if (rewardCoins > 0) {
      try {
        await this.walletsService.addCadeCoins(
          userId,
          rewardCoins,
          `CadeCoins reward for cart purchase (ACH settled)`,
        );
      } catch (err) {
        this.logger.error(`Failed to award CadeCoins on ACH settle: ${err}`);
      }
    }

    // Analytics: ACH cart funds cleared — record settled revenue + a
    // dedicated settlement event for the ACH funnel.
    this.trackCartPurchase({
      userId,
      buyer,
      itemCount: orderIds.length,
      amountCents: session.amount_total || 0,
      paymentMethod: 'ach',
      stripeSessionId: session.id,
    });
    this.mixpanel.track(AnalyticsEvent.ACH_PAYMENT_SETTLED, userId, {
      orderType: 'cart',
      itemCount: orderIds.length,
      amountUsd: (session.amount_total || 0) / 100,
      stripeSessionId: session.id,
    });
  }

  /**
   * Called from `payment_intent.payment_failed` for a cart checkout whose ACH
   * debit bounced. Reverts every order in the group (restores stock, refunds
   * any combined CadeCoins, flips → payment_failed) and notifies the seller and
   * buyer for each. Mirrors the single-item `PrizeService.handleAchPaymentFailed`.
   */
  async handleCartAchFailed(stripeSessionId: string): Promise<void> {
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.retrieve(stripeSessionId);
    } catch (err) {
      this.logger.error(
        `handleCartAchFailed: failed to retrieve session ${stripeSessionId}: ${err}`,
      );
      return;
    }

    const metadata = session.metadata;
    if (!metadata || metadata.type !== 'cart_checkout') return;

    const orderIds = metadata.orderIds.split(',');
    const userId = metadata.userId;
    const buyer = await this.userRepository.findOne({ where: { id: userId } });

    for (const orderId of orderIds) {
      const order = await this.prizeOrderRepository.findOne({
        where: { id: orderId },
        relations: ['prizeConfiguration'],
      });
      // Idempotency: only revert orders still reserved while ACH settled.
      if (!order || order.status !== 'payment_processing') continue;

      // Restore the stock slot reserved at checkout.
      try {
        await this.prizeConfigRepository.increment(
          { id: order.prizeConfigurationId },
          'stock',
          1,
        );
      } catch (err) {
        this.logger.error(
          `Failed to restore stock for order ${order.id} on ACH failure: ${err}`,
        );
      }

      // Refund any combined-payment CadeCoins deducted up-front.
      if (order.paymentMethod === 'combined' && order.coinsDeducted > 0) {
        try {
          await this.walletsService.addCadeCoins(
            userId,
            order.coinsDeducted,
            `Refund: ACH payment failed for cart order ${order.id}`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to refund CadeCoins for order ${order.id} on ACH failure: ${err}`,
          );
        }
      }

      order.status = 'payment_failed';
      await this.prizeOrderRepository.save(order);

      // Notify seller + buyer that the sale fell through.
      if (order.prizeConfiguration && buyer) {
        await this.purchaseNotifications.sendSellerPaymentFailedNotification(
          order,
          order.prizeConfiguration,
          buyer,
        );
        await this.purchaseNotifications.sendBuyerPaymentFailedNotification(
          order,
          order.prizeConfiguration,
          buyer,
        );
      }
    }

    this.logger.log(
      `Stripe webhook: cart ACH failed reverted for session ${stripeSessionId}`,
    );

    this.mixpanel.track(AnalyticsEvent.ACH_PAYMENT_FAILED, userId, {
      orderType: 'cart',
      itemCount: orderIds.length,
      amountUsd: (session.amount_total || 0) / 100,
      stripeSessionId: session.id,
    });
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
        orderType: 'bundle_offer',
        orderGroupId: bundleOfferId,
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
        const frontendUrl = this.configService.get<string>(
          'CLIENT_URL',
          'http://localhost:3000',
        );
        await this.emailsService.sendEmailSMTP(
          {
            toAddress: [seller.email],
            subject: 'New Bundle Offer Received',
            params: {
              sellerName: seller.name || seller.username,
              buyerName: buyer.name || buyer.username,
              itemNames,
              itemCount: items.length,
              offerAmount: dto.offerAmount.toFixed(2),
              reviewUrl: `${frontendUrl}/seller/shop/manage?tab=offers`,
            },
          },
          'bundle_offer',
        );
      } catch (err) {
        this.logger.error(`Failed to send bundle offer email: ${err}`);
      }
    }

    return orders;
  }

  /**
   * Summary of all orders in a checkout session (cart or accepted bundle),
   * for the post-checkout success page. Scoped to the requesting user.
   */
  async getCheckoutSessionSummary(
    userId: string,
    sessionId: string,
  ): Promise<{
    sessionId: string;
    isPaymentProcessing: boolean;
    orderCount: number;
    total: number;
    items: Array<{
      orderId: string;
      itemName: string;
      itemImage: string | null;
      itemCategory: string | null;
      status: string;
      totalPrice: number;
      usdCharged: number;
      paymentMethod: string;
      sellerName: string | null;
      sellerUsername: string | null;
    }>;
  }> {
    if (!sessionId) {
      throw new BadRequestException('session_id is required');
    }
    const orders = await this.prizeOrderRepository.find({
      where: { userId, stripeSessionId: sessionId },
      relations: [
        'prizeConfiguration',
        'prizeConfiguration.itemImages',
        'prizeConfiguration.creator',
      ],
      order: { createdAt: 'ASC' },
    });

    const items = orders.map((o) => {
      const pc = o.prizeConfiguration;
      const sortedImages = (pc?.itemImages || [])
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder);
      const itemImage = pc?.imageUrl || sortedImages[0]?.imageUrl || null;
      return {
        orderId: o.id,
        itemName: pc?.name || 'Item',
        itemImage,
        itemCategory: pc?.category || null,
        status: o.status,
        totalPrice: Number(o.totalPrice),
        usdCharged: Number(o.usdCharged),
        paymentMethod: o.paymentMethod,
        sellerName: pc?.creator?.name || pc?.creator?.username || null,
        sellerUsername: pc?.creator?.username || null,
      };
    });

    const isPaymentProcessing = orders.some(
      (o) => o.status === 'payment_processing',
    );
    const total = items.reduce(
      (sum, i) => sum + (i.usdCharged > 0 ? i.usdCharged : i.totalPrice),
      0,
    );

    return {
      sessionId,
      isPaymentProcessing,
      orderCount: items.length,
      total: Math.round(total * 100) / 100,
      items,
    };
  }

  /**
   * Build ONE Stripe checkout session for an accepted bundle offer over its
   * existing orders, then flip them all to `offer_accepted`. Reuses the
   * `cart_checkout` session shape so handleCheckoutSuccess / handleCartAchSettled
   * / handleCartAchFailed finalize the bundle (status, stock, per-order emails,
   * single seller transfer). Bundles are single-seller.
   *
   * Called by PrizeService.acceptBundleOffer (seller/admin accept or buyer
   * accept-counter). The orders passed in are the ones being accepted (already
   * loaded with prizeConfiguration + user).
   */
  async createBundleAcceptCheckout(
    orders: PrizeOrder[],
  ): Promise<Stripe.Checkout.Session> {
    if (orders.length === 0) {
      throw new BadRequestException('No bundle orders to accept');
    }
    const buyerUserId = orders[0].userId;
    const prize0 = orders[0].prizeConfiguration;
    const sellerId = prize0?.createdBy;
    if (!sellerId) {
      throw new BadRequestException('Bundle offers require a seller');
    }

    // Negotiated whole-bundle subtotal (identical on each order; read once,
    // do NOT sum). Counter wins if the seller countered.
    const subtotalUsd =
      orders[0].counterOfferAmount != null
        ? Number(orders[0].counterOfferAmount)
        : Number(orders[0].offerAmount || 0);
    const subtotalCents = Math.round(subtotalUsd * 100);

    // One shipping fee for the whole bundle.
    const shippingUsd =
      prize0?.shippingCostUsd != null
        ? Number(prize0.shippingCostUsd)
        : SHIPPING_FEE;
    const shippingCents = Math.round(shippingUsd * 100);

    // Bundle offers don't capture the buyer's Stripe method at offer time, so
    // default to card (also the conservative fee tier).
    const stripeMethod: 'card' | 'us_bank_account' =
      orders[0].stripePaymentMethod === 'us_bank_account'
        ? 'us_bank_account'
        : 'card';

    const buyerFeeCents = calculateBuyerItemFeeCents(
      subtotalCents,
      shippingCents,
      getBuyerFeePercentForStripeMethod(stripeMethod),
    );
    const totalChargeCents = subtotalCents + shippingCents + buyerFeeCents;

    // Single seller + deferred transfer (same model as cart checkout).
    const seller = await this.userRepository.findOne({
      where: { id: sellerId },
      relations: ['wallet'],
    });
    const sellerName = seller?.name || seller?.username || 'Seller';
    const transferInstructions: Array<{
      orderId: string;
      sellerId: string;
      stripeAccountId: string;
      amountCents: number;
    }> = [];
    if (seller?.stripeAccountId) {
      const sellerFeePercent = getEffectiveSellerFeePercent({
        lifetimeCadeCoins: Number(seller.wallet?.lifetimeCoinsEarned || 0),
        adminFeeOverridePercent:
          seller.adminFeeOverridePercent != null
            ? Number(seller.adminFeeOverridePercent)
            : null,
      });
      const sellerFeeCents = calculateSellerFeeCents(
        subtotalCents,
        sellerFeePercent,
      );
      transferInstructions.push({
        orderId: orders[0].id,
        sellerId,
        stripeAccountId: seller.stripeAccountId,
        amountCents: subtotalCents + shippingCents - sellerFeeCents,
      });
    }

    const clientUrl =
      this.configService.get<string>('CLIENT_URL') || 'http://localhost:8080';
    const orderIds = orders.map((o) => o.id);

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      payment_method_types: [
        stripeMethod,
      ] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${sellerName}'s bundle — ${orders.length} item${
                orders.length > 1 ? 's' : ''
              }`,
            },
            unit_amount: totalChargeCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${clientUrl}/cart/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/shop?status=cancel`,
      metadata: {
        type: 'cart_checkout',
        userId: buyerUserId,
        orderIds: orderIds.join(','),
        transferInstructions: JSON.stringify(transferInstructions),
      },
      payment_intent_data: {
        metadata: {
          type: 'cart_checkout',
          userId: buyerUserId,
          orderIds: orderIds.join(','),
        },
      },
    };

    const session = await this.stripe.checkout.sessions.create(sessionParams);

    // Flip all accepted orders → offer_accepted, attach session, distribute the
    // total charge across them for reporting. The webhook (cart_checkout path)
    // moves them to paid/payment_processing on payment.
    const perOrderUsd =
      Math.round(totalChargeCents / orders.length) / 100;
    for (const o of orders) {
      o.status = 'offer_accepted';
      o.stripeSessionId = session.id;
      o.stripePaymentMethod = stripeMethod;
      o.usdCharged = perOrderUsd;
    }
    await this.prizeOrderRepository.save(orders);

    return session;
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
    orderGroupId?: string,
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
      orderType: 'cart',
      orderGroupId: orderGroupId ?? null,
    });

    return this.prizeOrderRepository.save(order);
  }
}
