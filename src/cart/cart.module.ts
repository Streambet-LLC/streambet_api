import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { PrizeConfiguration } from '../prize/entities/prize-configuration.entity';
import { PrizeOrder } from '../prize/entities/prize-order.entity';
import { User } from '../users/entities/user.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { WalletsModule } from '../wallets/wallets.module';
import { EmailsModule } from '../emails/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Cart,
      CartItem,
      PrizeConfiguration,
      PrizeOrder,
      User,
      Wallet,
    ]),
    forwardRef(() => WalletsModule),
    EmailsModule,
  ],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
