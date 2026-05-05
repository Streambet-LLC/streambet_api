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

  /**
   * Returns whether a code is configured as a cart discount code.
   * (Has either discountPercent or discountAmountCents set.)
   */
  isDiscountConfigured(promo: PromoCode | null | undefined): boolean {
    if (!promo) return false;
    const hasPercent =
      promo.discountPercent !== null &&
      promo.discountPercent !== undefined &&
      Number(promo.discountPercent) > 0;
    const hasFixed =
      promo.discountAmountCents !== null &&
      promo.discountAmountCents !== undefined &&
      Number(promo.discountAmountCents) > 0;
    return hasPercent || hasFixed;
  }

  async findAllDiscountCodes(): Promise<PromoCode[]> {
    // Show every code that has discount fields configured.
    // A code may also have a coin amount (signup bonus); that's fine —
    // the same code string can act as both a promo code and a discount code.
    return this.promoCodeRepository
      .createQueryBuilder('p')
      .where('p.discountPercent IS NOT NULL AND p.discountPercent > 0')
      .orWhere('p.discountAmountCents IS NOT NULL AND p.discountAmountCents > 0')
      .orderBy('p.createdAt', 'DESC')
      .getMany();
  }

  async createDiscountCode(data: Partial<PromoCode>): Promise<PromoCode> {
    const code = (data.code ?? '').toUpperCase().trim();

    // Enforce maxUses=1 for single_use codes
    const maxUses =
      data.usageType === 'single_use' ? 1 : (data.maxUses ?? null);

    // If a row already exists for this code (e.g. it's currently configured
    // as a signup-bonus promo code), merge the discount fields onto it
    // instead of erroring. This lets a single code act as both a promo and
    // a discount code (e.g. PAKT credits coins on signup AND gives % off at
    // checkout).
    const existing = await this.promoCodeRepository.findOne({
      where: { code },
    });
    if (existing) {
      if (this.isDiscountConfigured(existing)) {
        throw new BadRequestException(
          `A discount code with value "${code}" already exists`,
        );
      }
      existing.discountType = data.discountType ?? existing.discountType;
      if (data.discountPercent !== undefined)
        existing.discountPercent = data.discountPercent;
      if (data.discountAmountCents !== undefined)
        existing.discountAmountCents = data.discountAmountCents;
      existing.usageType = data.usageType ?? existing.usageType;
      existing.maxUses = maxUses ?? undefined;
      existing.scope = data.scope ?? existing.scope;
      if (data.expiresAt !== undefined) existing.expiresAt = data.expiresAt;
      if (data.isActive !== undefined) existing.isActive = data.isActive;
      // Reset usage counter only if not previously configured as a discount
      existing.timesUsed = existing.timesUsed ?? 0;
      return this.promoCodeRepository.save(existing);
    }

    const entity = this.promoCodeRepository.create({
      ...data,
      code,
      currency: 'usd',
      amount: 0,
      timesUsed: 0,
      maxUses,
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

    // Enforce maxUses=1 for single_use codes
    if (data.usageType === 'single_use') {
      data.maxUses = 1;
    }

    Object.assign(promo, data);
    return this.promoCodeRepository.save(promo);
  }

  // ── Legacy coin promo (signup-bonus codes) ──

  /**
   * List all signup-bonus promo codes (amount > 0).
   * These are managed via the admin "Promo Codes" tab.
   */
  async findAllPromoCodes(): Promise<PromoCode[]> {
    return this.promoCodeRepository
      .createQueryBuilder('p')
      .where('p.amount > 0')
      .orderBy('p.createdAt', 'DESC')
      .getMany();
  }

  async createPromoCode(data: {
    code: string;
    amount: number;
    isActive?: boolean;
    expiresAt?: Date | null;
  }): Promise<PromoCode> {
    const code = (data.code ?? '').toUpperCase().trim();
    if (!code) {
      throw new BadRequestException('Code is required');
    }
    if (!data.amount || data.amount <= 0) {
      throw new BadRequestException(
        'Promo code amount must be greater than zero',
      );
    }

    // If a row already exists (e.g. configured as a discount code), merge
    // the signup-bonus fields onto it so the same code can serve both
    // purposes (signup bonus + cart discount).
    const existing = await this.promoCodeRepository.findOne({
      where: { code },
    });
    if (existing) {
      if (existing.amount && Number(existing.amount) > 0) {
        throw new BadRequestException(
          `A promo code with value "${code}" already exists`,
        );
      }
      existing.amount = data.amount;
      existing.currency = 'cade_coins';
      if (data.isActive !== undefined) existing.isActive = data.isActive;
      if (data.expiresAt !== undefined)
        existing.expiresAt = data.expiresAt ?? undefined;
      return this.promoCodeRepository.save(existing);
    }

    const entity = this.promoCodeRepository.create({
      code,
      currency: 'cade_coins',
      amount: data.amount,
      isActive: data.isActive ?? true,
      expiresAt: data.expiresAt ?? undefined,
      // Discount-code fields default off
      discountType: 'percent',
      discountPercent: undefined,
      discountAmountCents: undefined,
      usageType: 'per_account',
      maxUses: undefined,
      timesUsed: 0,
      scope: 'cart',
    });
    return this.promoCodeRepository.save(entity);
  }

  async updatePromoCode(
    id: string,
    data: {
      amount?: number;
      isActive?: boolean;
      expiresAt?: Date | null;
    },
  ): Promise<PromoCode> {
    const promo = await this.promoCodeRepository.findOne({ where: { id } });
    if (!promo) {
      throw new BadRequestException('Promo code not found');
    }
    if (data.amount !== undefined) {
      if (data.amount <= 0) {
        throw new BadRequestException(
          'Promo code amount must be greater than zero',
        );
      }
      promo.amount = data.amount;
    }
    if (data.isActive !== undefined) promo.isActive = data.isActive;
    if (data.expiresAt !== undefined) {
      promo.expiresAt = data.expiresAt ?? undefined;
    }
    return this.promoCodeRepository.save(promo);
  }

  // ── Legacy coin promo (unchanged) ──

  /**
   * Credit the signup-bonus coins for a code (if applicable).
   * Returns the matched PromoCode row (regardless of whether coins were
   * credited) so the caller can determine whether the same code is also a
   * cart discount code and surface that info to the user.
   */
  async creditPromo(
    userUuid: string,
    code: string,
  ): Promise<PromoCode | null> {
    const promo = await this.promoCodeRepository.findOne({
      where: { code: (code ?? '').toUpperCase().trim() },
    });

    if (!promo) return null;
    if (!promo.isActive) return promo;
    if (promo.expiresAt && new Date() > promo.expiresAt) return promo;

    if (
      promo.amount === undefined ||
      promo.amount === null ||
      Number(promo.amount) <= 0
    ) {
      // Not a coin-bonus promo code (likely a cart-discount-only code).
      return promo;
    }

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
      Number(promo.amount),
      currency,
      TransactionType.BONUS,
      `Promo Code: ${promo.code} Bonus ${Number(promo.amount)} coins`,
    );
    return promo;
  }
}
