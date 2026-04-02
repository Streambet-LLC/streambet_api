import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConciergeRequest,
  ConciergeRequestStatus,
} from './entities/concierge-request.entity';
import { User } from '../users/entities/user.entity';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ConciergeService {
  private readonly logger = new Logger(ConciergeService.name);

  constructor(
    @InjectRepository(ConciergeRequest)
    private readonly conciergeRequestRepository: Repository<ConciergeRequest>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Create a concierge request (seller + pro subscriber)
   */
  async createRequest(userId: string): Promise<ConciergeRequest> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isSeller) {
      throw new ForbiddenException(
        'Only sellers can request concierge support',
      );
    }

    if (!user.isProSubscriber) {
      throw new ForbiddenException(
        'Only CardCade Pro subscribers can request concierge support',
      );
    }

    // Check if there's already a pending/claimed request
    const existing = await this.conciergeRequestRepository.findOne({
      where: [
        { userId, status: ConciergeRequestStatus.PENDING },
        { userId, status: ConciergeRequestStatus.CLAIMED },
      ],
    });

    if (existing) {
      throw new ConflictException(
        'You already have an active concierge request',
      );
    }

    const request = this.conciergeRequestRepository.create({
      userId,
      status: ConciergeRequestStatus.PENDING,
    });

    return this.conciergeRequestRepository.save(request);
  }

  /**
   * Get all concierge requests (admin)
   */
  async getAllRequests(): Promise<ConciergeRequest[]> {
    return this.conciergeRequestRepository.find({
      relations: ['user', 'claimedByUser'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Admin claims a concierge request
   */
  async claimRequest(
    requestId: string,
    adminId: string,
  ): Promise<ConciergeRequest> {
    const request = await this.conciergeRequestRepository.findOne({
      where: { id: requestId },
      relations: ['user'],
    });

    if (!request) {
      throw new NotFoundException('Concierge request not found');
    }

    if (request.status === ConciergeRequestStatus.CLAIMED) {
      throw new ConflictException('This request has already been claimed');
    }

    const admin = await this.userRepository.findOne({
      where: { id: adminId },
    });

    request.status = ConciergeRequestStatus.CLAIMED;
    request.claimedBy = adminId;
    request.claimedByName = admin?.name || admin?.username || 'CardCade Team';
    request.claimedAt = new Date();

    await this.conciergeRequestRepository.save(request);

    // Notify the user that a concierge has been assigned
    if (request.user) {
      await this.notificationService.sendConciergeAssignedEmail(
        request.user,
        request.claimedByName,
      );
    }

    return request;
  }

  /**
   * Get concierge request status for a user
   */
  async getUserRequest(userId: string): Promise<ConciergeRequest | null> {
    return this.conciergeRequestRepository.findOne({
      where: [
        { userId, status: ConciergeRequestStatus.PENDING },
        { userId, status: ConciergeRequestStatus.CLAIMED },
      ],
      relations: ['claimedByUser'],
    });
  }
}
