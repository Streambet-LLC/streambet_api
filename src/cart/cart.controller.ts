import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CartService } from './cart.service';
import {
  AddToCartDto,
  UpdateCartItemDto,
  CartCheckoutDto,
  BundleOfferDto,
} from './dto/cart.dto';
import { User } from '../users/entities/user.entity';

interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get current cart with summary grouped by seller' })
  @ApiResponse({ status: 200, description: 'Cart summary retrieved' })
  async getCart(@Request() req: RequestWithUser) {
    const summary = await this.cartService.getCartSummary(req.user.id);
    return {
      data: {
        cartId: summary.cart.id,
        sellerGroups: summary.sellerGroups.map((group) => ({
          sellerId: group.sellerId,
          sellerName: group.sellerName,
          shopName: group.shopName,
          items: group.items.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            prizeConfiguration: {
              id: item.prizeConfiguration.id,
              name: item.prizeConfiguration.name,
              amount: item.prizeConfiguration.amount,
              imageUrl: item.prizeConfiguration.imageUrl,
              coverImageId: item.prizeConfiguration.coverImageId,
              stock: item.prizeConfiguration.stock,
              purchaseOption: item.prizeConfiguration.purchaseOption,
              category: item.prizeConfiguration.category,
              brand: item.prizeConfiguration.brand,
              createdBy: item.prizeConfiguration.createdBy,
            },
          })),
          itemSubtotal: (group.itemSubtotalCents / 100).toFixed(2),
          shipping: (group.shippingCents / 100).toFixed(2),
          buyerFee: (group.buyerFeeCents / 100).toFixed(2),
          total: (group.totalCents / 100).toFixed(2),
        })),
        totals: {
          itemSubtotal: (summary.cartTotals.itemSubtotalCents / 100).toFixed(2),
          shipping: (summary.cartTotals.shippingCents / 100).toFixed(2),
          buyerFee: (summary.cartTotals.buyerFeeCents / 100).toFixed(2),
          total: (summary.cartTotals.totalCents / 100).toFixed(2),
          itemCount: summary.cartTotals.itemCount,
        },
        removedItems: summary.removedItems,
      },
      message: 'Cart retrieved successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @Get('count')
  @ApiOperation({ summary: 'Get cart item count (for badge)' })
  @ApiResponse({ status: 200, description: 'Cart count retrieved' })
  async getCartCount(@Request() req: RequestWithUser) {
    const count = await this.cartService.getCartCount(req.user.id);
    return {
      data: { count },
      message: 'Cart count retrieved',
      statusCode: HttpStatus.OK,
    };
  }

  @Post('items')
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiResponse({ status: 201, description: 'Item added to cart' })
  async addToCart(
    @Request() req: RequestWithUser,
    @Body() dto: AddToCartDto,
  ) {
    await this.cartService.addToCart(req.user.id, dto);
    const summary = await this.cartService.getCartSummary(req.user.id);
    return {
      data: { itemCount: summary.cartTotals.itemCount },
      message: 'Item added to cart',
      statusCode: HttpStatus.CREATED,
    };
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Update cart item quantity' })
  @ApiParam({ name: 'itemId', description: 'Cart item ID' })
  @ApiResponse({ status: 200, description: 'Cart item updated' })
  async updateCartItem(
    @Request() req: RequestWithUser,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    await this.cartService.updateCartItem(req.user.id, itemId, dto);
    return {
      message: 'Cart item updated',
      statusCode: HttpStatus.OK,
    };
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove item from cart' })
  @ApiParam({ name: 'itemId', description: 'Cart item ID' })
  @ApiResponse({ status: 200, description: 'Item removed from cart' })
  async removeCartItem(
    @Request() req: RequestWithUser,
    @Param('itemId') itemId: string,
  ) {
    await this.cartService.removeCartItem(req.user.id, itemId);
    return {
      message: 'Item removed from cart',
      statusCode: HttpStatus.OK,
    };
  }

  @Delete()
  @ApiOperation({ summary: 'Empty entire cart' })
  @ApiResponse({ status: 200, description: 'Cart emptied' })
  async clearCart(@Request() req: RequestWithUser) {
    await this.cartService.clearCart(req.user.id);
    return {
      message: 'Cart emptied',
      statusCode: HttpStatus.OK,
    };
  }

  @Post('checkout')
  @ApiOperation({
    summary: 'Checkout cart — validates stock, creates orders and Stripe session',
  })
  @ApiResponse({ status: 200, description: 'Checkout initiated' })
  async checkout(
    @Request() req: RequestWithUser,
    @Body() dto: CartCheckoutDto,
  ) {
    const result = await this.cartService.checkout(req.user.id, dto);
    return {
      data: result,
      message: result.stripeSessionUrl
        ? 'Checkout session created'
        : 'Purchase completed with coins',
      statusCode: HttpStatus.OK,
    };
  }

  @Post('bundle-offer')
  @ApiOperation({
    summary: 'Submit a bundle offer for multiple items from the same seller',
  })
  @ApiResponse({ status: 201, description: 'Bundle offer submitted' })
  async submitBundleOffer(
    @Request() req: RequestWithUser,
    @Body() dto: BundleOfferDto,
  ) {
    const orders = await this.cartService.submitBundleOffer(req.user.id, dto);
    return {
      data: { orderIds: orders.map((o) => o.id) },
      message: 'Bundle offer submitted',
      statusCode: HttpStatus.CREATED,
    };
  }
}
