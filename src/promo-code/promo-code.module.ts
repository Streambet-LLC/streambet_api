import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromoCode } from './promo-code.entity';
import { PromoCodeService } from './promo-code.service';
import { WalletsModule } from 'src/wallets/wallets.module';

@Module({
  imports: [TypeOrmModule.forFeature([PromoCode]), WalletsModule],
  providers: [PromoCodeService],
  exports: [PromoCodeService],
})
export class PromoCodeModule {}
