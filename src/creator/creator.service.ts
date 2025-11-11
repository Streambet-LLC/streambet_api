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
import { StreamEventType, StreamList, StreamStatus } from 'src/enums/stream.enum';
import { STREAM_LIVE_QUEUE } from 'src/common/constants/queue.constants';
import { CurrencyType } from 'src/enums/currency.enum';
import { User } from 'src/users/entities/user.entity';
import { NotificationService } from 'src/notification/notification.service';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { BettingVariable } from 'src/betting/entities/betting-variable.entity';
import { AnalyticsSummaryResponseDto } from './dto/analytics.dto';
import { Stream } from 'src/stream/entities/stream.entity';

@Injectable()
export class CreatorService {
  private readonly logger = new Logger(CreatorService.name);
  constructor(
    @InjectRepository(Stream)
    private streamsRepository: Repository<Stream>,
    private dataSource: DataSource,
  ) {}

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
    creatorId
  } : {
    creatorId: string;
  }): Promise<AnalyticsSummaryResponseDto> {
    try {

      const totalViews = await this.streamsRepository.sum(
        "viewerCount", 
        {
          creatorId, 
        },
      );

      const totalStreams = await this.streamsRepository.count({
        where: {
          creatorId,
        }
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
      }

    } catch (e) {
      Logger.error('Unable to retrieve top live streams', e);
      throw new HttpException(
        `Unable to retrieve top live streams at the moment. Please try again later`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}