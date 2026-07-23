import { forwardRef, Module } from '@nestjs/common';
import { CoinPackageService } from './coin-package.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoinPackage } from './entities/coin-package.entity';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CoinPackage]),
    forwardRef(() => WalletsModule),
  ],
  controllers: [],
  providers: [CoinPackageService],
  exports: [CoinPackageService],
})
export class CoinPackageModule {}
