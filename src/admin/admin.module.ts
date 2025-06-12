import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { BettingModule } from '../betting/betting.module';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [BettingModule, UsersModule, WalletsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
