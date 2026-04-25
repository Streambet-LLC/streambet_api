import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiveFeedUpdate } from './live-feed-update.entity';
import { GatewayManager } from 'src/ws/gateway.manager';
import { emitToLiveFeed } from 'src/common/common';
import { LiveFeedType } from 'src/enums/live-feed-type.enum';

@Injectable()
export class LiveFeedUpdateService {
  constructor(
    private readonly gatewayManager: GatewayManager,
    @InjectRepository(LiveFeedUpdate)
    private readonly liveFeedRepository: Repository<LiveFeedUpdate>,
  ) {}

  async getLastUpdates() {
    const data = await this.liveFeedRepository.find({
      order: {
        createdAt: 'DESC',
      },
      take: 25,
      select: [
        'username',
        'type',
        'round',
        'stream',
        'option',
        'amount',
        'createdAt',
        'ranking',
      ],
    });

    return {
      data,
    };
  }

  async publishUpdate(
    type: LiveFeedType,
    username = '',
    stream = '',
    round = '',
    option = '',
    amount = 0,
    ranking = 0,
  ) {
    await this.liveFeedRepository
      .create({
        type,
        username,
        stream,
        round,
        option,
        amount,
        ranking,
      })
      .save();

    await emitToLiveFeed(this.gatewayManager, 'live-feed-update', {
      type,
      username,
      stream,
      round,
      option,
      amount,
      ranking,
    });
  }
}
