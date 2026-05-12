import { Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatorService } from './creator.service';

interface RequestWithUser extends ExpressRequest {
  user: { id: string; userId?: string; email?: string };
}

/**
 * Seller-onboarding endpoints. Mounted at `/creator/*` for backward
 * compatibility with the existing frontend client. The legacy
 * application/approval flow was removed when sellers became self-serve;
 * `is_seller` now flips automatically once the in-app questionnaire is
 * completed (see `users.service#profileUpdate`).
 */
@Controller('creator')
@UseGuards(JwtAuthGuard)
export class CreatorController {
  constructor(private readonly creatorService: CreatorService) {}

  @Post('create-connect-link')
  async createConnectLink(@Request() req: RequestWithUser) {
    return this.creatorService.createConnectLink(req.user);
  }

  @Get('stripe-status')
  async getMyStripeStatus(@Request() req: RequestWithUser) {
    const userId = req.user.userId ?? req.user.id;
    const data = await this.creatorService.getMyStripeStatus(userId);
    return { data };
  }
}
