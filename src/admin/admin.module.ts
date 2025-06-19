import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { BettingModule } from '../betting/betting.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    UsersModule,
    BettingModule,
    WalletsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
