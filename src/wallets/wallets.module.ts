import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';
import { WalletsService } from './wallets.service';
import { UsersModule } from '../users/users.module';
import { WalletGateway } from './wallets.gateway';
import { WsModule } from 'src/ws/ws.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, Transaction]),
    forwardRef(() => UsersModule),
    forwardRef(() => WsModule),
  ],
  controllers: [],
  providers: [WalletsService, WalletGateway],
  exports: [WalletsService, WalletGateway],
})
export class WalletsModule {}
