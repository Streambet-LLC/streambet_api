import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromoCode } from './promo-code.entity';
import { DiscountCodeRedemption } from './discount-code-redemption.entity';
import { PromoCodeService } from './promo-code.service';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PromoCode, DiscountCodeRedemption]),
    forwardRef(() => WalletsModule),
  ],
  providers: [PromoCodeService],
  exports: [PromoCodeService],
})
export class PromoCodeModule {}
