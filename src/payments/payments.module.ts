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
import { PrizeOrder } from 'src/prize/entities/prize-order.entity';
import { PrizeModule } from 'src/prize/prize.module';
import { User } from 'src/users/entities/user.entity';
import { Webhook } from 'src/webhook/entities/webhook.entity';
import { EmailsModule } from 'src/emails/email.module';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    forwardRef(() => CoinPackageModule),
    forwardRef(() => WalletsModule),
    forwardRef(() => NotificationModule),
    forwardRef(() => QueueModule),
    forwardRef(() => PrizeModule),
    forwardRef(() => EmailsModule),
    TypeOrmModule.forFeature([Transaction, PrizeOrder, User, Webhook]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
