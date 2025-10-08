import { forwardRef, Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { WalletsModule } from '../wallets/wallets.module';
import { CoinPackageModule } from '../coin-package/coin-package.module';
import { UsersModule } from '../users/users.module';
import { NotificationModule } from 'src/notification/notification.module';
import { QueueModule } from 'src/queue/queue.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from 'src/wallets/entities/transaction.entity';

@Module({
  imports: [
    UsersModule,
    forwardRef(() => CoinPackageModule),
    forwardRef(() => WalletsModule),
    forwardRef(() => NotificationModule),
    forwardRef(() => QueueModule),
    TypeOrmModule.forFeature([Transaction]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
