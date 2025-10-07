import { forwardRef, Module } from '@nestjs/common';
import { CoinPackageService } from './coin-package.service';
import { CoinPackageController } from './coin-package.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoinPackage } from './entities/coin-package.entity';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CoinPackage]), 
    forwardRef(() => WalletsModule)
  ],
  controllers: [CoinPackageController],
  providers: [CoinPackageService],
  exports: [CoinPackageService],
})
export class CoinPackageModule {}
