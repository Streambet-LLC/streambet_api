import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { ApplicationType, CreatorApplicationDto } from './dto/creator-application.dto';
import { CreatorApplication } from './entities/creator-application.entity';
import { EmailsService } from 'src/emails/email.service';
import { EmailType } from 'src/enums/email-type.enum';
import { ConfigService } from '@nestjs/config';
import { stripe } from 'src/integrations/stripe';

@Injectable()
export class CreatorService {
  private readonly logger = new Logger(CreatorService.name);
  constructor(
    @InjectRepository(CreatorApplication)
    private creatorApplicationsRepository: Repository<CreatorApplication>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private dataSource: DataSource,
    private emailsService: EmailsService,
    private configService: ConfigService,
  ) {}

  async upsertCreatorApplication({
    userId,
    applicationDto,
  }: {
    userId: string;
    applicationDto: CreatorApplicationDto;
  }) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new HttpException(
        `Logged in user not existing in system`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const existing = await this.creatorApplicationsRepository.findOne({
        where: { userId, isDeleted: false },
      });

      let application;

      if (existing) {
        // Update existing application
        const updateData: any = {
          firstName: applicationDto.firstName,
          lastName: applicationDto.lastName,
          email: applicationDto.email,
          applicationType: ApplicationType.SELLER,
          collectorBackground: applicationDto.collectorBackground,
          cityState: applicationDto.cityState,
          cardsCollected: applicationDto.cardsCollected,
          cardPreference: applicationDto.cardPreference,
        };

        await this.creatorApplicationsRepository.update(
          existing.id,
          updateData,
        );

        return;
      }

      // Create new application
      const createData: any = {
        userId,
        firstName: applicationDto.firstName,
        lastName: applicationDto.lastName,
        email: applicationDto.email,
        applicationType: ApplicationType.SELLER,
        collectorBackground: applicationDto.collectorBackground,
        cityState: applicationDto.cityState,
        cardsCollected: applicationDto.cardsCollected,
        cardPreference: applicationDto.cardPreference,
      };

      application = this.creatorApplicationsRepository.create(createData);
      await this.creatorApplicationsRepository.save(application);

      // Send email notification for new seller applications
      try {
          const emailHTML = `
            <html>
              <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>New Seller Application Submitted</h2>
                <p>A new seller application has been submitted:</p>
                <ul>
                  <li><strong>Name:</strong> ${applicationDto.firstName} ${applicationDto.lastName}</li>
                  <li><strong>Email:</strong> ${applicationDto.email}</li>
                  <li><strong>Submitted:</strong> ${new Date().toLocaleString()}</li>
                </ul>
                <p>Please review the application in the admin panel.</p>
              </body>
            </html>
          `;

          const emailParams = {
            to: 'contact@cardcade.fun',
            subject: 'New Seller Application Submitted',
          };

          await this.emailsService.sendEmailFn(emailParams, emailHTML);
          this.logger.log(
            'Seller application notification email sent to contact@cardcade.fun',
          );
        } catch (emailError) {
          this.logger.error(
            'Failed to send seller application notification email',
            emailError,
          );
          // Don't throw - we don't want email failure to block the application
        }

      return;
    } catch (e) {
      Logger.error('Unable to upsert creator application', e);
      throw new HttpException(
        `Unable to upsert creator application at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getCreatorApplication({ userId }: { userId: string }) {
    try {
      const application = await this.creatorApplicationsRepository.findOne({
        where: { userId, isDeleted: false },
      });

      return application;
    } catch (e) {
      Logger.error('Unable to get creator application', e);
      throw new HttpException(
        `Unable to get creator application at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async cancelCreatorApplication({ userId }: { userId: string }) {
    try {
      const application = await this.creatorApplicationsRepository.findOne({
        where: { userId, isDeleted: false },
      });

      if (!application) return;

      await this.creatorApplicationsRepository.update(application.id, {
        isDeleted: true,
      });

      return;
    } catch (e) {
      Logger.error('Unable to cancel creator application', e);
      throw new HttpException(
        `Unable to cancel creator application at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getAllApplications(filters: {
    status?: string;
    page?: number;
    limit?: number;
  }) {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 25;
      const skip = (page - 1) * limit;

      const where: any = { isDeleted: false };

      if (filters.status) {
        where.applicationStatus = filters.status;
      }

      const [applications, total] =
        await this.creatorApplicationsRepository.findAndCount({
          where,
          relations: ['user'],
          order: { createdAt: 'DESC' },
          skip,
          take: limit,
        });

      return {
        data: applications,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (e) {
      Logger.error('Unable to get all applications', e);
      throw new HttpException(
        `Unable to get all applications at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async approveApplication(applicationId: string, adminUserId: string) {
    try {
      const application = await this.creatorApplicationsRepository.findOne({
        where: { id: applicationId, isDeleted: false },
        relations: ['user'],
      });

      if (!application) {
        throw new NotFoundException('Application not found');
      }

      if (application.applicationStatus === 'approved') {
        throw new ConflictException('Application is already approved');
      }

      // Update application status
      application.applicationStatus = 'approved';
      application.reviewedAt = new Date();
      application.reviewedByUserId = adminUserId;

      await this.creatorApplicationsRepository.save(application);

      // Grant seller flag + Stripe Connect account to user
      const user = application.user;
      const stripeAccount = await stripe.createConnectedAccount(
        application.user.email,
      );
      user.isSeller = true;
      user.stripeAccountId = stripeAccount.accountId;
      // Set default shop name if not already set
      if (!user.shopName) {
        user.shopName = `${user.username}'s Shop`;
      }
      this.logger.log(`Granted seller flag to user ${user.id}`);

      await this.userRepository.save(user);

      // Send approval email
      try {
        const hostUrl = this.configService.get<string>('email.HOST_URL') || '';
        const dashboardLink = `${hostUrl}/seller/shop/manage`;
        const emailData = {
          toAddress: [user.email],
          subject: `Your seller application has been approved!`,
          params: {
            username: user.username,
            applicationType: ApplicationType.SELLER,
            dashboardLink,
          },
        };
        await this.emailsService.sendEmailSMTP(
          emailData,
          EmailType.ApplicationApproved,
        );
        this.logger.log(`Sent approval email to ${user.email}`);
      } catch (emailError) {
        this.logger.error('Failed to send approval email', emailError);
        // Don't throw - application was approved successfully
      }

      return application;
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ConflictException) {
        throw e;
      }
      Logger.error('Unable to approve application', e);
      throw new HttpException(
        `Unable to approve application at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

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
                if (seller.applicationFeePercent !== 4) {
                  updates.applicationFeePercent = 4;
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
      applicationFeePercent: 4,
    });

    return { message: 'Seller marked as onboarded' };
  }

  async createConnectLink(user) {
    const seller = await this.userRepository.findOne({
      where: {
        id: user.userId,
      },
    });

    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    // If this seller doesn't have a Stripe Connect account yet (e.g. became a
    // seller before the Stripe flow was added), create one now.
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

  async rejectApplication(applicationId: string, adminUserId: string) {
    try {
      const application = await this.creatorApplicationsRepository.findOne({
        where: { id: applicationId, isDeleted: false },
        relations: ['user'],
      });

      if (!application) {
        throw new NotFoundException('Application not found');
      }

      if (application.applicationStatus === 'rejected') {
        throw new ConflictException('Application is already rejected');
      }

      // Update application status
      application.applicationStatus = 'rejected';
      application.reviewedAt = new Date();
      application.reviewedByUserId = adminUserId;

      await this.creatorApplicationsRepository.save(application);

      // Send rejection email
      try {
        const user = application.user;
        const dashboardLink =
          this.configService.get<string>('email.HOST_URL') || '';
        const emailData = {
          toAddress: [user.email],
          subject: `Update on your ${application.applicationType} application`,
          params: {
            username: user.username,
            applicationType: application.applicationType,
            dashboardLink,
          },
        };
        await this.emailsService.sendEmailSMTP(
          emailData,
          EmailType.ApplicationRejected,
        );
        this.logger.log(`Sent rejection email to ${user.email}`);
      } catch (emailError) {
        this.logger.error('Failed to send rejection email', emailError);
        // Don't throw - application was rejected successfully
      }

      return application;
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ConflictException) {
        throw e;
      }
      Logger.error('Unable to reject application', e);
      throw new HttpException(
        `Unable to reject application at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
