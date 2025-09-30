import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { UsersModule } from '../users/users.module';
import { WalletGateway } from './wallets.gateway';
import { WsModule } from 'src/ws/ws.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, Transaction]),
    UsersModule,
    WsModule,
  ],
  controllers: [WalletsController],
  providers: [WalletsService, WalletGateway],
  exports: [WalletsService, WalletGateway],
})
export class WalletsModule {}
