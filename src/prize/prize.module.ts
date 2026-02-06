import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrizeConfiguration } from './entities/prize-configuration.entity';
import { PrizeRedemption } from './entities/prize-redemption.entity';
import { User } from '../users/entities/user.entity';
import { PrizeService } from './prize.service';
import { PrizeController, AdminPrizeController } from './prize.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PrizeConfiguration, PrizeRedemption, User]),
  ],
  controllers: [PrizeController, AdminPrizeController],
  providers: [PrizeService],
  exports: [PrizeService],
})
export class PrizeModule {}
