import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { BettingModule } from '../betting/betting.module';
import { WalletsModule } from '../wallets/wallets.module';
import { Stream } from 'src/stream/entities/stream.entity';
import { StreamService } from 'src/stream/stream.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Stream]),
    UsersModule,
    BettingModule,
    WalletsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, StreamService],
})
export class AdminModule {}
