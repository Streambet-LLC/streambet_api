import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { stripe } from 'src/integrations/stripe';

/**
 * Seller / Stripe-Connect helper service.
 *
 * Historical context: this used to host the long-form "creator/seller
 * application" workflow (admin approval queue, status emails, etc.). When
 * sellers became self-serve, all of that was retired in favor of the
 * in-app questionnaire (`users.profileUpdate` flips `is_seller` once the
 * `sellerProfileCompleted` flag is set). Only the Stripe Connect helpers
 * remain here.
 */
@Injectable()
export class CreatorService {
  private readonly logger = new Logger(CreatorService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async getSellersWithPendingOnboarding() {
    try {
      const sellers = await this.userRepository.find({
        where: {
          isSeller: true,
          stripeAccountConnected: false,
        },
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          shopName: true,
          stripeAccountId: true,
          applicationFeePercent: true,
        },
        order: { username: 'ASC' },
      });
      return sellers;
    } catch (e) {
      Logger.error('Unable to get sellers with pending onboarding', e);
      throw new HttpException(
        `Unable to get sellers with pending onboarding at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getAllSellersStripeStatus() {
    try {
      const sellers = await this.userRepository.find({
        where: { isSeller: true },
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          shopName: true,
          stripeAccountId: true,
          stripeAccountConnected: true,
          sellerOnboardingCompleted: true,
          applicationFeePercent: true,
        },
        order: { username: 'ASC' },
      });

      // Enrich each seller with live Stripe account status
      // Auto-sync onboarding flags if Stripe says they're fully verified
      const enriched = await Promise.all(
        sellers.map(async (seller) => {
          let stripeStatus = {
            detailsSubmitted: false,
            chargesEnabled: false,
            payoutsEnabled: false,
          };

          if (seller.stripeAccountId) {
            try {
              const account = await stripe.retrieveAccount(
                seller.stripeAccountId,
              );
              stripeStatus = {
                detailsSubmitted: account.details_submitted ?? false,
                chargesEnabled: account.charges_enabled ?? false,
                payoutsEnabled: account.payouts_enabled ?? false,
              };

              // Auto-sync: if Stripe says fully verified but local flags are behind, update them
              if (
                account.details_submitted &&
                account.charges_enabled &&
                account.payouts_enabled
              ) {
                const updates: Record<string, boolean | number> = {};
                if (!seller.stripeAccountConnected) {
                  updates.stripeAccountConnected = true;
                  seller.stripeAccountConnected = true;
                }
                if (!seller.sellerOnboardingCompleted) {
                  updates.sellerOnboardingCompleted = true;
                  seller.sellerOnboardingCompleted = true;
                }
                // Ensure the seller fee is always set to the current default
                if (seller.applicationFeePercent !== 2) {
                  updates.applicationFeePercent = 2;
                }
                if (Object.keys(updates).length > 0) {
                  await this.userRepository.update(seller.id, updates);
                  Logger.log(
                    `Auto-synced onboarding flags for seller ${seller.id} (${seller.username}): ${JSON.stringify(updates)}`,
                  );
                }
              }
            } catch (err) {
              Logger.warn(
                `Failed to retrieve Stripe account ${seller.stripeAccountId} for user ${seller.id}: ${err.message}`,
              );
            }
          }

          return {
            ...seller,
            stripeStatus,
          };
        }),
      );

      return enriched;
    } catch (e) {
      Logger.error('Unable to get sellers stripe status', e);
      throw new HttpException(
        'Unable to get seller Stripe status at the moment. Please try again later',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async markSellerOnboardingComplete(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isSeller) {
      throw new HttpException('User is not a seller', HttpStatus.BAD_REQUEST);
    }

    // Update both flags regardless of current state (idempotent)
    // Also ensure the seller fee is set to the current default
    await this.userRepository.update(userId, {
      stripeAccountConnected: true,
      sellerOnboardingCompleted: true,
      applicationFeePercent: 2,
    });

    return { message: 'Seller marked as onboarded' };
  }

  async createConnectLink(user) {
    const sellerId = user?.userId ?? user?.id;
    const seller = await this.userRepository.findOne({
      where: {
        id: sellerId,
      },
    });

    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    // If this seller doesn't have a Stripe Connect account yet (e.g. became a
    // seller before the Stripe flow was added, or just finished the in-app
    // questionnaire), create one now.
    if (!seller.stripeAccountId) {
      const stripeAccount = await stripe.createConnectedAccount(seller.email);
      seller.stripeAccountId = stripeAccount.accountId;
      await this.userRepository.update(seller.id, {
        stripeAccountId: stripeAccount.accountId,
      });
    }

    const accountLink = await stripe.createAccountLink(seller.stripeAccountId);

    return accountLink;
  }

  /**
   * Returns the live Stripe Connect status for the current user.
   * Also auto-syncs local flags if Stripe says the account is fully verified
   * (mirrors the admin endpoint behavior so a returning seller eventually
   * stops seeing onboarding prompts without an admin click).
   */
  async getMyStripeStatus(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const base = {
      hasStripeAccount: !!user.stripeAccountId,
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      sellerOnboardingCompleted: !!user.sellerOnboardingCompleted,
      stripeAccountConnected: !!user.stripeAccountConnected,
    };

    if (!user.stripeAccountId) {
      return base;
    }

    try {
      const account = await stripe.retrieveAccount(user.stripeAccountId);
      const detailsSubmitted = account.details_submitted ?? false;
      const chargesEnabled = account.charges_enabled ?? false;
      const payoutsEnabled = account.payouts_enabled ?? false;

      // Auto-sync if Stripe is happy but local flags are behind.
      if (detailsSubmitted && chargesEnabled && payoutsEnabled) {
        const updates: Record<string, boolean | number> = {};
        if (!user.stripeAccountConnected) updates.stripeAccountConnected = true;
        if (!user.sellerOnboardingCompleted)
          updates.sellerOnboardingCompleted = true;
        if (user.applicationFeePercent !== 2) updates.applicationFeePercent = 2;
        if (Object.keys(updates).length > 0) {
          await this.userRepository.update(user.id, updates);
          this.logger.log(
            `Auto-synced Stripe flags for ${user.id} (${user.username}): ${JSON.stringify(updates)}`,
          );
        }
        return {
          ...base,
          detailsSubmitted,
          chargesEnabled,
          payoutsEnabled,
          stripeAccountConnected: true,
          sellerOnboardingCompleted: true,
        };
      }

      return {
        ...base,
        detailsSubmitted,
        chargesEnabled,
        payoutsEnabled,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to retrieve Stripe account for user ${user.id}: ${(err as Error).message}`,
      );
      return base;
    }
  }
}
