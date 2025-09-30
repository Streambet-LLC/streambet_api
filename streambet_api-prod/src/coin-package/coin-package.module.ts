import { Module } from '@nestjs/common';
import { CoinPackageService } from './coin-package.service';
import { CoinPackageController } from './coin-package.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoinPackage } from './entities/coin-package.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CoinPackage])],
  controllers: [CoinPackageController],
  providers: [CoinPackageService],
  exports: [CoinPackageService],
})
export class CoinPackageModule {}
