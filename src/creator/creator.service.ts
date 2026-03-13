import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
  OnModuleDestroy,
  OnApplicationShutdown,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { FilterDto, Range, Sort } from 'src/common/filters/filter.dto';
import { UpdateStreamDto } from '../betting/dto/update-stream.dto';
import { WalletsService } from 'src/wallets/wallets.service';
import { Wallet } from 'src/wallets/entities/wallet.entity';
import { BettingRoundStatus } from 'src/enums/round-status.enum';
import { BetStatus } from 'src/enums/bet-status.enum';
import { PlatformName } from 'src/enums/platform-name.enum';
import { QueueService } from 'src/queue/queue.service';
import { BettingService } from 'src/betting/betting.service';
import { BettingSummaryService } from 'src/redis/betting-summary.service';
import {
  StreamEventType,
  StreamList,
  StreamStatus,
} from 'src/enums/stream.enum';
import { STREAM_LIVE_QUEUE } from 'src/common/constants/queue.constants';
import { CurrencyType } from 'src/enums/currency.enum';
import { User } from 'src/users/entities/user.entity';
import { NotificationService } from 'src/notification/notification.service';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { BettingVariable } from 'src/betting/entities/betting-variable.entity';
import { CreatorAnalyticsSummaryResponseDto } from './dto/analytics.dto';
import { Stream } from 'src/stream/entities/stream.entity';
import { CreatorApplicationDto, ApplicationType } from './dto/creator-application.dto';
import { CreatorApplication } from './entities/creator-application.entity';
import { UserRole } from 'src/enums/user-role.enum';
import { EmailsService } from 'src/emails/email.service';
import { EmailType } from 'src/enums/email-type.enum';
import { ConfigService } from '@nestjs/config';
import { stripe } from 'src/integrations/stripe';

@Injectable()
export class CreatorService {
  private readonly logger = new Logger(CreatorService.name);
  constructor(
    @InjectRepository(Stream)
    private streamsRepository: Repository<Stream>,
    @InjectRepository(CreatorApplication)
    private creatorApplicationsRepository: Repository<CreatorApplication>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private dataSource: DataSource,
    private emailsService: EmailsService,
    private configService: ConfigService,
  ) { }

  private formatDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600)
      .toString()
      .padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const seconds = Math.floor(totalSeconds % 60)
      .toString()
      .padStart(2, '0');
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  async getAnalyticsSummary({
    creatorId,
  }: {
    creatorId: string;
  }): Promise<CreatorAnalyticsSummaryResponseDto> {
    try {
      const totalViews = await this.streamsRepository.sum('viewerCount', {
        creatorId,
      });

      const totalStreams = await this.streamsRepository.count({
        where: {
          creatorId,
        },
      });

      const result = await this.dataSource.query(`
        SELECT SUM(EXTRACT(EPOCH FROM ("endTime" - "scheduledStartTime"))) AS total_seconds
        FROM streams
        WHERE "scheduledStartTime" IS NOT NULL AND "endTime" IS NOT NULL
        AND "creatorId"='${creatorId}'
      `);

      const totalSeconds = parseFloat(result[0].total_seconds) || 0;
      const totalLiveTime = this.formatDuration(totalSeconds);

      return {
        totalViews,
        totalStreams,
        totalLiveTime,
      };
    } catch (e) {
      Logger.error('Unable to retrieve top live streams', e);
      throw new HttpException(
        `Unable to retrieve top live streams at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

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

    if (user.role === UserRole.CREATOR) {
      throw new ConflictException('User is already a creator');
    }

    try {
      const existing = await this.creatorApplicationsRepository.findOne({
        where: { userId, isDeleted: false },
      });

      const applicationType = applicationDto.applicationType || ApplicationType.CREATOR;
      let application;

      if (existing) {
        // Update existing application
        const updateData: any = {
          firstName: applicationDto.firstName,
          lastName: applicationDto.lastName,
          email: applicationDto.email,
          applicationType,
        };

        // Add creator-specific fields if provided
        if (applicationType === ApplicationType.CREATOR) {
          updateData.socials = applicationDto.socials;
          updateData.message = applicationDto.message;
        }

        // Add seller-specific fields if provided
        if (applicationType === ApplicationType.SELLER) {
          updateData.socials = applicationDto.socials;
          updateData.collectorBackground = applicationDto.collectorBackground;
          updateData.cityState = applicationDto.cityState;
          updateData.cardsCollected = applicationDto.cardsCollected;
          updateData.cardPreference = applicationDto.cardPreference;
        }

        await this.creatorApplicationsRepository.update(existing.id, updateData);

        return;
      }

      // Create new application
      const createData: any = {
        userId,
        firstName: applicationDto.firstName,
        lastName: applicationDto.lastName,
        email: applicationDto.email,
        applicationType,
      };

      // Add creator-specific fields if provided
      if (applicationType === ApplicationType.CREATOR) {
        createData.socials = applicationDto.socials;
        createData.message = applicationDto.message;
      }

      // Add seller-specific fields if provided
      if (applicationType === ApplicationType.SELLER) {
        createData.socials = applicationDto.socials;
        createData.collectorBackground = applicationDto.collectorBackground;
        createData.cityState = applicationDto.cityState;
        createData.cardsCollected = applicationDto.cardsCollected;
        createData.cardPreference = applicationDto.cardPreference;
      }

      application = this.creatorApplicationsRepository.create(createData);
      await this.creatorApplicationsRepository.save(application);

      // Send email notification for new seller applications
      if (applicationType === ApplicationType.SELLER) {
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
            to: 'info@streambet.tv',
            subject: 'New Seller Application Submitted',
          };

          await this.emailsService.sendEmailFn(emailParams, emailHTML);
          this.logger.log('Seller application notification email sent to info@streambet.tv');
        } catch (emailError) {
          this.logger.error('Failed to send seller application notification email', emailError);
          // Don't throw - we don't want email failure to block the application
        }
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
    applicationType?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 25;
      const skip = (page - 1) * limit;

      const where: any = { isDeleted: false };

      if (filters.applicationType) {
        where.applicationType = filters.applicationType;
      }

      if (filters.status) {
        where.applicationStatus = filters.status;
      }

      const [applications, total] = await this.creatorApplicationsRepository.findAndCount({
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

      // Grant appropriate role/flag to user
      const user = application.user;
      if (application.applicationType === ApplicationType.SELLER) {
        const stripeAccount = await stripe.createConnectedAccount(application.user.email);
        user.isSeller = true;
        user.stripeAccountId = stripeAccount.accountId;
        // Set default shop name if not already set
        if (!user.shopName) {
          user.shopName = `${user.username}'s Shop`;
        }
        this.logger.log(`Granted seller flag to user ${user.id}`);
      } else if (application.applicationType === ApplicationType.CREATOR) {
        user.role = UserRole.CREATOR;
        user.isCreator = true;
        this.logger.log(`Granted creator role to user ${user.id}`);
      }

      await this.userRepository.save(user);

      // Send approval email
      try {
        const dashboardLink = this.configService.get<string>('email.HOST_URL') || '';
        const emailData = {
          toAddress: [user.email],
          subject: `Your ${application.applicationType} application has been approved!`,
          params: {
            username: user.username,
            applicationType: application.applicationType,
            dashboardLink,
          },
        };
        await this.emailsService.sendEmailSMTP(emailData, EmailType.ApplicationApproved);
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

  async markSellerOnboardingComplete(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isSeller) {
      throw new HttpException('User is not a seller', HttpStatus.BAD_REQUEST);
    }

    if (user.stripeAccountConnected) {
      throw new ConflictException(
        'Seller stripe onboarding is already marked as completed',
      );
    }

    await this.userRepository.update(userId, {
      stripeAccountConnected: true,
    });
  }

  async createConnectLink(user) {
    const seller = await this.userRepository.findOne({
      where: {
        id: user.userId,
      }
    });

    const accountLink = await stripe.createAccountLink(seller.stripeAccountId ?? "");

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
        const dashboardLink = this.configService.get<string>('email.HOST_URL') || '';
        const emailData = {
          toAddress: [user.email],
          subject: `Update on your ${application.applicationType} application`,
          params: {
            username: user.username,
            applicationType: application.applicationType,
            dashboardLink,
          },
        };
        await this.emailsService.sendEmailSMTP(emailData, EmailType.ApplicationRejected);
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
