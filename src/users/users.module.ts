import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ReferralService } from 'src/referral/referral.service';
import { ReferralLink } from 'src/referral/referral-link.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, ReferralLink])],
  controllers: [UsersController],
  providers: [UsersService, ReferralService],
  exports: [UsersService],
})
export class UsersModule { }
