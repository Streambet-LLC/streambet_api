import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { WalletsModule } from '../wallets/wallets.module';
import { CoinPackageModule } from '../coin-package/coin-package.module';
import { BettingModule } from '../betting/betting.module';
import { UsersModule } from '../users/users.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [WalletsModule, UsersModule, CoinPackageModule, BettingModule, NotificationModule],
  controllers: [PaymentsController],
  providers: [PaymentsService,],
  exports: [PaymentsService],
})
export class PaymentsModule {}
