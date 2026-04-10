import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromoCode } from './promo-code.entity';
import { DiscountCodeRedemption } from './discount-code-redemption.entity';
import { WalletsService } from '../wallets/wallets.service';
import { CurrencyType } from '../enums/currency.enum';
import { TransactionType } from '../enums/transaction-type.enum';

export interface DiscountValidationResult {
  valid: boolean;
  discountCodeId?: string;
  code?: string;
  discountType?: 'percent' | 'fixed_amount';
  discountPercent?: number;
  discountAmountCents?: number;
  scope?: 'cart' | 'cheapest_item';
  message: string;
}

@Injectable()
export class PromoCodeService {
  private readonly logger = new Logger(PromoCodeService.name);

  constructor(
    @InjectRepository(PromoCode)
    private readonly promoCodeRepository: Repository<PromoCode>,
    @InjectRepository(DiscountCodeRedemption)
    private readonly redemptionRepository: Repository<DiscountCodeRedemption>,
    private readonly walletsService: WalletsService,
  ) {}

  /**
   * Validate a promo code for a specific user (cart checkout).
   * Does NOT record the redemption — that happens after payment succeeds.
   */
  async validateForCart(
    code: string,
    userId: string,
  ): Promise<DiscountValidationResult> {
    const promo = await this.promoCodeRepository.findOne({
      where: { code: code.toUpperCase().trim() },
    });

    if (!promo) {
      return { valid: false, message: 'Invalid discount code' };
    }
    if (!promo.isActive) {
      return {
        valid: false,
        message: 'This discount code is no longer active',
      };
    }
    if (promo.expiresAt && new Date() > promo.expiresAt) {
      return { valid: false, message: 'This discount code has expired' };
    }

    // Check global usage limit (single_use codes have maxUses=1)
    if (promo.maxUses !== null && promo.maxUses !== undefined) {
      if (promo.timesUsed >= promo.maxUses) {
        return {
          valid: false,
          message: 'This discount code has already been fully redeemed',
        };
      }
    }

    // Check per-account usage
    if (promo.usageType === 'per_account') {
      const existing = await this.redemptionRepository.findOne({
        where: { discountCodeId: promo.id, userId },
      });
      if (existing) {
        return {
          valid: false,
          message: 'You have already used this discount code',
        };
      }
    }

    // single_use: maxUses check above covers it (maxUses=1, timesUsed >= 1)

    return {
      valid: true,
      discountCodeId: promo.id,
      code: promo.code,
      discountType: promo.discountType,
      discountPercent: promo.discountPercent
        ? Number(promo.discountPercent)
        : undefined,
      discountAmountCents: promo.discountAmountCents ?? undefined,
      scope: promo.scope ?? 'cart',
      message: this.describeDiscount(promo),
    };
  }

  /**
   * Calculate the discount in cents for a given order subtotal.
   * When scope is 'cheapest_item', the discount is calculated against
   * cheapestItemCents instead of the full subtotal.
   */
  calculateDiscountCents(
    promo: DiscountValidationResult,
    subtotalCents: number,
    cheapestItemCents?: number,
  ): number {
    if (!promo.valid) return 0;
    const baseCents =
      promo.scope === 'cheapest_item' && cheapestItemCents !== undefined
        ? cheapestItemCents
        : subtotalCents;
    if (promo.discountType === 'percent' && promo.discountPercent) {
      return Math.round(baseCents * (promo.discountPercent / 100));
    }
    if (promo.discountType === 'fixed_amount' && promo.discountAmountCents) {
      return Math.min(promo.discountAmountCents, baseCents);
    }
    return 0;
  }

  /**
   * Record a redemption after payment succeeds.
   * Increments times_used and inserts into promo_code_redemptions.
   */
  async recordRedemption(
    discountCodeId: string,
    userId: string,
    discountCents: number,
    stripeSessionId?: string,
  ): Promise<void> {
    // Increment times_used
    await this.promoCodeRepository.increment(
      { id: discountCodeId },
      'timesUsed',
      1,
    );

    // Insert redemption (ignore if duplicate — edge case safety)
    try {
      const redemption = this.redemptionRepository.create({
        discountCodeId,
        userId,
        discountCents,
        stripeSessionId,
      });
      await this.redemptionRepository.save(redemption);
    } catch (err: unknown) {
      // Unique constraint violation = user already redeemed (race condition)
      this.logger.warn(
        `Duplicate discount code redemption attempt: code=${discountCodeId} user=${userId}`,
      );
    }
  }

  private describeDiscount(promo: PromoCode): string {
    const target =
      promo.scope === 'cheapest_item' ? 'an item in your cart' : 'your order';
    if (promo.discountType === 'percent' && promo.discountPercent) {
      return `${Number(promo.discountPercent)}% off ${target}`;
    }
    if (promo.discountType === 'fixed_amount' && promo.discountAmountCents) {
      return `$${(promo.discountAmountCents / 100).toFixed(2)} off ${target}`;
    }
    return 'Discount applied';
  }

  // ── Admin CRUD ──

  async findAllDiscountCodes(): Promise<PromoCode[]> {
    return this.promoCodeRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async createDiscountCode(data: Partial<PromoCode>): Promise<PromoCode> {
    const code = (data.code ?? '').toUpperCase().trim();

    const existing = await this.promoCodeRepository.findOne({
      where: { code },
    });
    if (existing) {
      throw new BadRequestException(
        `A code with value "${code}" already exists`,
      );
    }

    const entity = this.promoCodeRepository.create({
      ...data,
      code,
      currency: 'usd',
      timesUsed: 0,
    });
    return this.promoCodeRepository.save(entity);
  }

  async updateDiscountCode(
    id: string,
    data: Partial<PromoCode>,
  ): Promise<PromoCode> {
    const promo = await this.promoCodeRepository.findOne({ where: { id } });
    if (!promo) {
      throw new BadRequestException('Discount code not found');
    }

    // Don't allow changing the code string itself
    delete (data as any).code;

    Object.assign(promo, data);
    return this.promoCodeRepository.save(promo);
  }

  // ── Legacy coin promo (unchanged) ──

  async creditPromo(userUuid: string, code: string) {
    const promo = await this.promoCodeRepository.findOne({
      where: { code },
    });

    if (promo) {
      let currency = CurrencyType.CADE_COINS;
      switch (promo.currency) {
        case 'gold_coins':
          currency = CurrencyType.GOLD_COINS;
          break;
        case 'stream_coins':
          currency = CurrencyType.STREAM_COINS;
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
