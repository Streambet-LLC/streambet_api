import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not, Brackets } from 'typeorm';
import { Conversation, ConversationType } from './entities/conversation.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { Message } from './entities/message.entity';
import { MessageAttachment } from './entities/message-attachment.entity';
import { UserBlock } from './entities/user-block.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../enums/user-role.enum';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  ListConversationsDto,
  ListMessagesDto,
  ConversationTab,
} from './dto/list-conversations.dto';
import {
  AdminListConversationsDto,
  AdminConversationTab,
} from './dto/admin-inbox.dto';
import { UpdateInboxSettingsDto } from './dto/update-inbox-settings.dto';
import { QueueService } from '../queue/queue.service';
import { EmailType } from '../enums/email-type.enum';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(ConversationParticipant)
    private readonly participantRepo: Repository<ConversationParticipant>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(MessageAttachment)
    private readonly attachmentRepo: Repository<MessageAttachment>,
    @InjectRepository(UserBlock)
    private readonly blockRepo: Repository<UserBlock>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  ) {}

  // ─── CREATE CONVERSATION ──────────────────────────────────────────────

  async createConversation(userId: string, dto: CreateConversationDto) {
    const sender = await this.userRepo.findOne({ where: { id: userId } });
    if (!sender) throw new NotFoundException('User not found');

    if (dto.type === ConversationType.DIRECT) {
      if (!dto.recipientId) {
        throw new BadRequestException(
          'recipientId is required for direct messages',
        );
      }
      if (dto.recipientId === userId) {
        throw new BadRequestException('You cannot message yourself');
      }

      const recipient = await this.userRepo.findOne({
        where: { id: dto.recipientId },
      });
      if (!recipient) throw new NotFoundException('Recipient not found');

      if (!recipient.isSeller) {
        throw new ForbiddenException('You can only message sellers');
      }

      // Check if blocked
      const isBlocked = await this.blockRepo.findOne({
        where: [
          { blockerId: dto.recipientId, blockedId: userId },
          { blockerId: userId, blockedId: dto.recipientId },
        ],
      });
      if (isBlocked) {
        throw new ForbiddenException(
          'You cannot start a conversation with this user',
        );
      }

      // Check for existing conversation between these two users
      const existing = await this.findExistingDirectConversation(
        userId,
        dto.recipientId,
      );
      if (existing) {
        // Send the message in the existing conversation
        await this.sendMessage(userId, existing.id, {
          content: dto.initialMessage,
        });
        return existing;
      }
    }

    // Create conversation
    const conversation = this.conversationRepo.create({
      type: dto.type,
      subject: dto.subject,
    });
    const saved = await this.conversationRepo.save(conversation);

    // Add sender as participant
    await this.participantRepo.save(
      this.participantRepo.create({
        conversationId: saved.id,
        userId,
      }),
    );

    if (dto.type === ConversationType.DIRECT) {
      // Add recipient as participant
      await this.participantRepo.save(
        this.participantRepo.create({
          conversationId: saved.id,
          userId: dto.recipientId,
        }),
      );
    } else if (dto.type === ConversationType.SUPPORT) {
      // For support, add all admins as participants
      const admins = await this.userRepo.find({
        where: { role: UserRole.ADMIN },
      });
      for (const admin of admins) {
        if (admin.id !== userId) {
          await this.participantRepo.save(
            this.participantRepo.create({
              conversationId: saved.id,
              userId: admin.id,
            }),
          );
        }
      }
    }

    // Send initial message
    await this.sendMessage(userId, saved.id, {
      content: dto.initialMessage,
    });

    return this.getConversationById(saved.id, userId);
  }

  // ─── SEND MESSAGE ────────────────────────────────────────────────────

  async sendMessage(
    senderId: string,
    conversationId: string,
    dto: SendMessageDto,
    isAdminMessage = false,
    adminName?: string,
  ) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    // Check sender is a participant
    const participant = await this.participantRepo.findOne({
      where: { conversationId, userId: senderId },
    });
    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }

    // Check if blocked by other participant (for direct conversations)
    if (conversation.type === ConversationType.DIRECT && !isAdminMessage) {
      const otherParticipant = await this.participantRepo.findOne({
        where: { conversationId, userId: Not(senderId) },
      });
      if (otherParticipant) {
        if (participant.isBlocked) {
          throw new ForbiddenException(
            'You have been blocked by this user and cannot send messages',
          );
        }
        if (otherParticipant.isBlocked) {
          throw new ForbiddenException(
            'You have blocked this user. Unblock them to send messages',
          );
        }
      }
    }

    // Determine if sender has read receipts enabled
    const sender = await this.userRepo.findOne({ where: { id: senderId } });
    const hasReadReceipt = sender?.readReceiptsEnabled ?? false;

    // Create message
    const message = this.messageRepo.create({
      conversationId,
      senderId,
      content: dto.content,
      isAdminMessage,
      adminName: isAdminMessage ? adminName : null,
      hasReadReceipt: hasReadReceipt,
    });
    const savedMessage = await this.messageRepo.save(message);

    // Save attachments
    if (dto.attachments && dto.attachments.length > 0) {
      const attachments = dto.attachments.map((att) =>
        this.attachmentRepo.create({
          messageId: savedMessage.id,
          fileUrl: att.fileUrl,
          fileName: att.fileName,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
        }),
      );
      await this.attachmentRepo.save(attachments);
    }

    // Update sender's last read
    participant.lastReadAt = new Date();
    await this.participantRepo.save(participant);

    // Send email notification to other participants
    await this.notifyRecipients(conversationId, senderId, dto.content);

    return this.messageRepo.findOne({
      where: { id: savedMessage.id },
      relations: ['sender', 'attachments'],
    });
  }

  // ─── LIST CONVERSATIONS ──────────────────────────────────────────────

  async listConversations(userId: string, dto: ListConversationsDto) {
    const { tab, page, limit } = dto;
    const skip = (page - 1) * limit;

    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .innerJoin(
        'c.participants',
        'myParticipant',
        'myParticipant.userId = :userId',
        { userId },
      )
      .leftJoinAndSelect('c.participants', 'participants')
      .leftJoinAndSelect('participants.user', 'participantUser');

    if (tab === ConversationTab.SUPPORT) {
      qb.andWhere('c.type = :type', { type: ConversationType.SUPPORT });
      qb.andWhere('myParticipant.isBlocked = false');
    } else if (tab === ConversationTab.BLOCKED) {
      qb.andWhere('myParticipant.isBlocked = true');
    } else {
      // ALL tab: show non-blocked conversations
      qb.andWhere('myParticipant.isBlocked = false');
    }

    qb.orderBy('c.updatedAt', 'DESC').skip(skip).take(limit);

    const [conversations, total] = await qb.getManyAndCount();

    // For each conversation, get last message and unread count
    const enriched = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await this.messageRepo.findOne({
          where: { conversationId: conv.id },
          order: { createdAt: 'DESC' },
          relations: ['sender'],
        });

        const myParticipant = conv.participants.find(
          (p) => p.userId === userId,
        );
        const unreadCount = await this.getUnreadCountForConversation(
          conv.id,
          myParticipant?.lastReadAt,
        );

        return {
          ...conv,
          lastMessage,
          unreadCount,
          isBlocked: myParticipant?.isBlocked ?? false,
        };
      }),
    );

    return { data: enriched, total, page, limit };
  }

  // ─── GET CONVERSATION MESSAGES ────────────────────────────────────────

  async getConversationMessages(
    userId: string,
    conversationId: string,
    dto: ListMessagesDto,
  ) {
    // Verify the user is a participant
    const participant = await this.participantRepo.findOne({
      where: { conversationId, userId },
    });
    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }

    const { page, limit } = dto;
    const skip = (page - 1) * limit;

    const [messages, total] = await this.messageRepo.findAndCount({
      where: { conversationId },
      relations: ['sender', 'attachments'],
      order: { createdAt: 'ASC' },
      skip,
      take: limit,
    });

    return { data: messages, total, page, limit };
  }

  // ─── MARK AS READ ────────────────────────────────────────────────────

  async markConversationAsRead(userId: string, conversationId: string) {
    const participant = await this.participantRepo.findOne({
      where: { conversationId, userId },
    });
    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }

    const now = new Date();
    participant.lastReadAt = now;
    await this.participantRepo.save(participant);

    // Update read receipts on messages from other senders
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (user) {
      await this.messageRepo
        .createQueryBuilder()
        .update(Message)
        .set({ readAt: now })
        .where('conversationId = :conversationId', { conversationId })
        .andWhere('senderId != :userId', { userId })
        .andWhere('hasReadReceipt = true')
        .andWhere('readAt IS NULL')
        .execute();
    }

    return { success: true };
  }

  // ─── BLOCK / UNBLOCK ─────────────────────────────────────────────────

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const blockedUser = await this.userRepo.findOne({
      where: { id: blockedId },
    });
    if (!blockedUser) throw new NotFoundException('User not found');

    // Check if already blocked
    const existing = await this.blockRepo.findOne({
      where: { blockerId, blockedId },
    });
    if (existing) {
      throw new BadRequestException('User is already blocked');
    }

    // Create block record
    await this.blockRepo.save(
      this.blockRepo.create({ blockerId, blockedId }),
    );

    // Mark conversation participants as blocked
    const sharedConversations = await this.conversationRepo
      .createQueryBuilder('c')
      .innerJoin('c.participants', 'p1', 'p1.userId = :blockerId', {
        blockerId,
      })
      .innerJoin('c.participants', 'p2', 'p2.userId = :blockedId', {
        blockedId,
      })
      .where('c.type = :type', { type: ConversationType.DIRECT })
      .getMany();

    for (const conv of sharedConversations) {
      // Mark the blocker's participant as blocked (moves to blocked tab)
      await this.participantRepo.update(
        { conversationId: conv.id, userId: blockerId },
        { isBlocked: true, blockedAt: new Date() },
      );
      // Mark the blocked user's participant too so they know
      await this.participantRepo.update(
        { conversationId: conv.id, userId: blockedId },
        { isBlocked: true, blockedAt: new Date() },
      );
    }

    return { success: true };
  }

  async unblockUser(blockerId: string, blockedId: string) {
    const block = await this.blockRepo.findOne({
      where: { blockerId, blockedId },
    });
    if (!block) throw new NotFoundException('Block not found');

    await this.blockRepo.remove(block);

    // Unblock conversation participants
    const sharedConversations = await this.conversationRepo
      .createQueryBuilder('c')
      .innerJoin('c.participants', 'p1', 'p1.userId = :blockerId', {
        blockerId,
      })
      .innerJoin('c.participants', 'p2', 'p2.userId = :blockedId', {
        blockedId,
      })
      .where('c.type = :type', { type: ConversationType.DIRECT })
      .getMany();

    for (const conv of sharedConversations) {
      await this.participantRepo.update(
        { conversationId: conv.id, userId: blockerId },
        { isBlocked: false, blockedAt: null },
      );
      await this.participantRepo.update(
        { conversationId: conv.id, userId: blockedId },
        { isBlocked: false, blockedAt: null },
      );
    }

    return { success: true };
  }

  // ─── UNREAD COUNT ─────────────────────────────────────────────────────

  async getUnreadCount(userId: string) {
    const participants = await this.participantRepo.find({
      where: { userId, isBlocked: false },
    });

    let total = 0;
    for (const p of participants) {
      total += await this.getUnreadCountForConversation(
        p.conversationId,
        p.lastReadAt,
      );
    }

    return { unreadCount: total };
  }

  // ─── SETTINGS ─────────────────────────────────────────────────────────

  async updateInboxSettings(userId: string, dto: UpdateInboxSettingsDto) {
    await this.userRepo.update(userId, {
      readReceiptsEnabled: dto.readReceiptsEnabled,
    });
    return { success: true, readReceiptsEnabled: dto.readReceiptsEnabled };
  }

  async getInboxSettings(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    return { readReceiptsEnabled: user?.readReceiptsEnabled ?? true };
  }

  // ─── ADMIN METHODS ───────────────────────────────────────────────────

  async adminListConversations(dto: AdminListConversationsDto) {
    const { tab, search, page, limit } = dto;
    const skip = (page - 1) * limit;

    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.participants', 'participants')
      .leftJoinAndSelect('participants.user', 'participantUser');

    if (tab === AdminConversationTab.SUPPORT) {
      qb.andWhere('c.type = :type', { type: ConversationType.SUPPORT });
    } else {
      qb.andWhere('c.type = :type', { type: ConversationType.DIRECT });
    }

    if (search) {
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('participantUser.username ILIKE :search', {
              search: `%${search}%`,
            })
            .orWhere('c.subject ILIKE :search', { search: `%${search}%` });
        }),
      );
    }

    qb.orderBy('c.updatedAt', 'DESC').skip(skip).take(limit);

    const [conversations, total] = await qb.getManyAndCount();

    // Enrich with last message
    const enriched = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await this.messageRepo.findOne({
          where: { conversationId: conv.id },
          order: { createdAt: 'DESC' },
          relations: ['sender'],
        });
        const totalMessages = await this.messageRepo.count({
          where: { conversationId: conv.id },
        });
        return { ...conv, lastMessage, totalMessages };
      }),
    );

    return { data: enriched, total, page, limit };
  }

  async adminGetConversationMessages(
    conversationId: string,
    dto: ListMessagesDto,
  ) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const { page, limit } = dto;
    const skip = (page - 1) * limit;

    const [messages, total] = await this.messageRepo.findAndCount({
      where: { conversationId },
      relations: ['sender', 'attachments'],
      order: { createdAt: 'ASC' },
      skip,
      take: limit,
    });

    return {
      data: messages,
      total,
      page,
      limit,
      conversation,
    };
  }

  async adminSendMessage(
    adminUserId: string,
    conversationId: string,
    content: string,
  ) {
    const admin = await this.userRepo.findOne({
      where: { id: adminUserId },
    });
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }

    // Ensure admin is a participant (add them if not)
    let participant = await this.participantRepo.findOne({
      where: { conversationId, userId: adminUserId },
    });
    if (!participant) {
      participant = await this.participantRepo.save(
        this.participantRepo.create({
          conversationId,
          userId: adminUserId,
        }),
      );
    }

    return this.sendMessage(
      adminUserId,
      conversationId,
      { content },
      true,
      admin.name || admin.username,
    );
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────

  private async findExistingDirectConversation(
    userId1: string,
    userId2: string,
  ): Promise<Conversation | null> {
    const result = await this.conversationRepo
      .createQueryBuilder('c')
      .innerJoin('c.participants', 'p1', 'p1.userId = :userId1', { userId1 })
      .innerJoin('c.participants', 'p2', 'p2.userId = :userId2', { userId2 })
      .where('c.type = :type', { type: ConversationType.DIRECT })
      .getOne();

    return result;
  }

  private async getConversationById(conversationId: string, userId: string) {
    return this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: ['participants', 'participants.user'],
    });
  }

  private async getUnreadCountForConversation(
    conversationId: string,
    lastReadAt: Date | null,
  ): Promise<number> {
    const qb = this.messageRepo
      .createQueryBuilder('m')
      .where('m.conversationId = :conversationId', { conversationId });

    if (lastReadAt) {
      qb.andWhere('m.createdAt > :lastReadAt', { lastReadAt });
    }

    return qb.getCount();
  }

  private async notifyRecipients(
    conversationId: string,
    senderId: string,
    messageContent: string,
  ) {
    try {
      const participants = await this.participantRepo.find({
        where: { conversationId, isBlocked: false },
        relations: ['user'],
      });

      const sender = await this.userRepo.findOne({
        where: { id: senderId },
      });

      const hostUrl =
        this.configService.get<string>('email.HOST_URL') || '';

      for (const participant of participants) {
        if (participant.userId === senderId) continue;
        if (!participant.user?.email) continue;

        // Check notification preferences
        if (!participant.user.notificationPreferences?.emailNotification) {
          continue;
        }

        // Skip example emails
        if (participant.user.email.indexOf('@example.com') !== -1) continue;

        const conversationLink = `${hostUrl}/inbox?conversation=${conversationId}`;
        const subject = `New message from ${sender?.username || 'a user'} on CardCade`;

        const emailData = {
          toAddress: [participant.user.email],
          subject,
          params: {
            recipientName: participant.user.username || participant.user.name,
            senderName: sender?.username || sender?.name || 'A user',
            messagePreview:
              messageContent.length > 200
                ? messageContent.substring(0, 200) + '...'
                : messageContent,
            conversationLink,
          },
        };

        await this.queueService.addEmailJob(
          emailData,
          EmailType.InboxMessage,
        );
      }
    } catch (error) {
      this.logger.error('Failed to send inbox notification email', error);
    }
  }
}
