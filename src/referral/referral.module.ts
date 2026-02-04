import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferralLink } from './referral-link.entity';
import { ReferralService } from './referral.service';

@Module({
  imports: [TypeOrmModule.forFeature([ReferralLink])],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class PlatformPayoutModule {}
