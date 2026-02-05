import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BetRoundHistory } from './bet-round-history.entity';
import { BetRoundHistoryEventType } from 'src/enums/bet-round-history-event-type.enum';

@Injectable()
export class BetRoundHistoryService {
  constructor(
    @InjectRepository(BetRoundHistory)
    private readonly betRoundHistoryRepository: Repository<BetRoundHistory>,
  ) {}

  async recordBetRoundHistory(
    causerId: string,
    betRoundId: string,
    eventType: BetRoundHistoryEventType,
    description: string,
  ) {
    const history = this.betRoundHistoryRepository.create({
      causer_id: causerId,
      bet_round_uuid: betRoundId,
      event_type: eventType,
      description,
    });

    await this.betRoundHistoryRepository.save(history);
  }
}
