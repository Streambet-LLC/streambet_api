import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromoCode } from './promo-code.entity';
import { WalletsService } from 'src/wallets/wallets.service';
import { CurrencyType } from 'src/enums/currency.enum';
import { TransactionType } from 'src/enums/transaction-type.enum';

@Injectable()
export class PromoCodeService {
  constructor(
    @InjectRepository(PromoCode)
    private readonly promoCodeRepository: Repository<PromoCode>,
    private readonly walletsService: WalletsService,
  ) {

  }

  async creditPromo(userUuid: string, code: string) {
    console.log(userUuid, code);

    const promo = await this.promoCodeRepository.findOne({
      where: {
        code: code,
      }
    });

    if (promo) {
      let currency = CurrencyType.CADE_COINS;

      switch (promo.currency) {
        case "gold_coins":
          currency = CurrencyType.GOLD_COINS;
          break;
        case "stream_coins":
          currency = CurrencyType.STREAM_COINS
          break;
      }
      await this.walletsService.updateBalance(
        userUuid,
        promo.amount,
        currency,
        TransactionType.BONUS,
        `Promo Code: ${promo.code} Bonus ${promo.amount} coins`,
      );
    }
  }
}
