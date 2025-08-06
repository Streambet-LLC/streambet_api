import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from './entities/chat.entity';
import { User } from '../users/entities/user.entity';
import { Stream } from '../stream/entities/stream.entity';
import { ChatMessagesFilterDto } from './dto/list-chat.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Stream)
    private readonly streamRepository: Repository<Stream>,
  ) {}

  /**
   * Creates a new chat message for a given stream and user.
   * @param streamId - The ID of the stream.
   * @param userId - The ID of the user.
   * @param message - The chat message content.
   * @param imageURL - Optional image URL.
   * @param timestamp - Optional timestamp.
   * @returns The created Chat entity.
   */
  async createChatMessage(
    streamId: string,
    userId: string,
    message?: string,
    imageURL?: string,
    timestamp?: Date,
    systemMessage?: string,
  ): Promise<Chat> {
    const stream = await this.streamRepository.findOne({
      where: { id: streamId },
    });
    if (!stream) throw new NotFoundException('Stream not found');
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const chat = this.chatRepository.create({
      stream,
      user,
      message,
      imageURL,
      timestamp: timestamp || new Date(), // Use provided timestamp or current time
      systemMessage
    });
    return this.chatRepository.save(chat);
  }

  async getMessagesByStreamId(
    filter: ChatMessagesFilterDto,
  ): Promise<{ data: any[]; total: number }> {
    try {
      const { streamId, range, sort } = filter;
      // Safely parse pagination with validation
      let offset = 0,
        limit = 20;
      if (range) {
        try {
          const parsed = JSON.parse(range);
          if (Array.isArray(parsed) && parsed.length === 2) {
            offset = Math.max(0, parseInt(parsed[0]) || 0);
            limit = Math.min(100, Math.max(1, parseInt(parsed[1]) || 20)); // Max 100 items
          }
        } catch (e) {
          throw new HttpException(
            'Invalid range format',
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // Safely parse sort with whitelist validation
      let sortColumn = 'createdAt',
        sortOrder = 'DESC';
      const allowedColumns = ['createdAt', 'updatedAt', 'message', 'timestamp'];
      if (sort) {
        try {
          const parsed = JSON.parse(sort);
          if (Array.isArray(parsed) && parsed.length === 2) {
            if (allowedColumns.includes(parsed[0])) {
              sortColumn = parsed[0];
            }
            sortOrder = ['ASC', 'DESC'].includes(parsed[1]?.toUpperCase())
              ? parsed[1].toUpperCase()
              : 'DESC';
          }
        } catch (e) {
          throw new HttpException(
            'Invalid sort format',
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      const qb = this.chatRepository
        .createQueryBuilder('chat')
        .leftJoin('chat.user', 'user')
        .addSelect([
          'user.id',
          'user.username',
          'user.email',
          'user.profileImageUrl',
        ])
        .where('chat.stream_id = :streamId', { streamId })
        .orderBy(`chat.${sortColumn}`, sortOrder as 'ASC' | 'DESC')
        .offset(offset)
        .limit(limit);

      const total = await qb.getCount();
      const data = await qb.getMany();

      return { data, total };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      Logger.error(e);
      throw new HttpException(
        'Unable to retrieve chat messages at the moment. Please try again later.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
