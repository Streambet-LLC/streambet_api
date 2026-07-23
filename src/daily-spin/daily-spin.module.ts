import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailySpinService } from './daily-spin.service';
import { Transaction } from '../wallets/entities/transaction.entity';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction]), WalletsModule],
  controllers: [],
  providers: [DailySpinService],
  exports: [DailySpinService],
})
export class DailySpinModule {}
