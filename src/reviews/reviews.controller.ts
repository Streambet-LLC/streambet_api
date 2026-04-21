import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.requests.dto';
import { ListReviewsQueryDto } from './dto/list-reviews.dto';
import { User } from '../users/entities/user.entity';

interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  // ─── Public reads ───────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Get aggregate review stats for a user (as buyer + as seller)',
  })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('user/:username/stats')
  async getUserStats(@Param('username') username: string) {
    const data = await this.reviewsService.getUserStats(username);
    return {
      data,
      message: 'Review stats fetched successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({
    summary: 'List reviews about a user',
    description:
      'Use ?role=as_buyer (reviews of them as a buyer, written by sellers), as_seller (reviews of them as a seller, written by buyers), or all.',
  })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('user/:username')
  async listReviewsForUser(
    @Request() req: RequestWithUser,
    @Param('username') username: string,
    @Query() query: ListReviewsQueryDto,
  ) {
    const viewerId = req.user ? req.user.id : null;
    const data = await this.reviewsService.listReviewsForUser(
      username,
      query,
      viewerId,
    );
    return {
      data,
      message: 'Reviews fetched successfully',
      statusCode: HttpStatus.OK,
    };
  }

  // ─── Authed write/owner reads ───────────────────────────────────────

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a review for one of my orders' })
  @Post()
  async createReview(
    @Request() req: RequestWithUser,
    @Body() dto: CreateReviewDto,
  ) {
    const data = await this.reviewsService.createReview(req.user.id, dto);
    return {
      data,
      message: 'Review submitted successfully',
      statusCode: HttpStatus.CREATED,
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update one of my reviews (within 7 days)' })
  @Patch(':id')
  async updateReview(
    @Request() req: RequestWithUser,
    @Param('id') reviewId: string,
    @Body() dto: UpdateReviewDto,
  ) {
    const data = await this.reviewsService.updateReview(
      req.user.id,
      reviewId,
      dto,
    );
    return {
      data,
      message: 'Review updated successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete one of my reviews (within 14 days)' })
  @Delete(':id')
  async deleteReview(
    @Request() req: RequestWithUser,
    @Param('id') reviewId: string,
  ) {
    await this.reviewsService.deleteReview(req.user.id, reviewId);
    return {
      data: null,
      message: 'Review deleted successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "List my orders that I can review (and any review I've left)",
  })
  @Get('me/reviewable')
  async getMyReviewable(@Request() req: RequestWithUser) {
    const data = await this.reviewsService.getReviewableOrdersForUser(
      req.user.id,
    );
    return {
      data,
      message: 'Reviewable orders fetched successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get my review for a specific order (with counterparty info)',
  })
  @Get('order/:orderId')
  async getReviewForOrder(
    @Request() req: RequestWithUser,
    @Param('orderId') orderId: string,
  ) {
    const data = await this.reviewsService.getReviewForOrder(
      req.user.id,
      orderId,
    );
    return {
      data,
      message: 'Order review info fetched successfully',
      statusCode: HttpStatus.OK,
    };
  }
}
