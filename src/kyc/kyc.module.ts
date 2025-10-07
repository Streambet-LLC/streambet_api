import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { PaymentsModule } from 'src/payments/payments.module';

@Module({
  imports: [PaymentsModule, UsersModule],
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
