import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { UserRole } from 'src/enums/user-role.enum';
import { PaymentsService } from 'src/payments/payments.service';
import { User } from 'src/users/entities/user.entity';

interface RequestWithUser extends Request {
  user: User;
}

/**
 * Admin-only controls for reconciling stranded ACH prize orders against
 * Stripe. Useful for manually re-driving settlement in prod when a webhook
 * was missed, and for testing the reconciler on demand.
 */
@ApiTags('admin-ach-reconciler')
@ApiBearerAuth()
@Controller('admin/ach-reconciler')
@UseGuards(JwtAuthGuard)
export class AchReconcilerAdminController {
  constructor(private readonly paymentsService: PaymentsService) {}

  private ensureAdmin(user: User): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  @Post('run')
  @ApiOperation({
    summary:
      'Reconcile prize orders stuck in payment_processing against Stripe (admin). ' +
      'Settles orders whose ACH PaymentIntent has succeeded and reverts canceled ones.',
  })
  @ApiResponse({
    status: 201,
    description: 'Reconciliation summary',
    schema: {
      properties: {
        scanned: { type: 'number' },
        settled: { type: 'number' },
        failed: { type: 'number' },
        stillProcessing: { type: 'number' },
        skippedNoPaymentIntent: { type: 'number' },
        errors: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async run(
    @Request() req: RequestWithUser,
    @Body() body?: { olderThanMinutes?: number; limit?: number },
  ): Promise<{
    scanned: number;
    settled: number;
    failed: number;
    stillProcessing: number;
    skippedNoPaymentIntent: number;
    errors: number;
  }> {
    this.ensureAdmin(req.user);
    const summary = await this.paymentsService.reconcileProcessingAchOrders({
      // Manual runs reconcile everything by default so an admin can fix a
      // stranded order immediately without waiting out the cron's age gate.
      olderThanMinutes: body?.olderThanMinutes ?? 0,
      limit: body?.limit,
    });
    return summary;
  }
}
