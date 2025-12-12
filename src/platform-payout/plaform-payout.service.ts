import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PlatformPayout } from './entities/platform-payout.entity';
import { QueryRunner, Repository } from 'typeorm';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { Stream } from 'src/stream/entities/stream.entity';
import { User } from 'src/users/entities/user.entity';
import { Bet } from 'src/betting/entities/bet.entity';
import { BettingVariable } from 'src/betting/entities/betting-variable.entity';
import { WalletsService } from 'src/wallets/wallets.service';
import { CurrencyType } from 'src/enums/currency.enum';

@Injectable()
export class PlatformPayoutService {
  constructor(
    @InjectRepository(PlatformPayout)
    private readonly platformPayoutRepository: Repository<PlatformPayout>,
    @InjectRepository(Stream)
    private readonly streamRepository: Repository<Stream>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Bet)
    private readonly betRepository: Repository<Bet>,
    @InjectRepository(BettingVariable)
    private readonly bettingVariableRepository: Repository<BettingVariable>,
    private readonly walletsService: WalletsService,
  ) { }

  async recordPayout(
    queryRunner: QueryRunner,
    payoutAmount: number,
    winningOption: BettingVariable,
  ): Promise<void> {
    const stream = await this.streamRepository.findOne({
      where: { id: winningOption.streamId },
    });

    const creatorAssigned = stream.creatorId
      ? await this.userRepository.findOne({
          where: { id: stream.creatorId },
        })
      : null;

    let platformPayout = payoutAmount;
    let creatorPayout = 0;
    let createSplitPct = 0;

    if (creatorAssigned) {
      createSplitPct = creatorAssigned.revShare;
      creatorPayout = platformPayout * (createSplitPct / 100);

      if (creatorPayout > 0) {
        await this.walletsService.creditPayout(
          creatorAssigned.id,
          creatorPayout,
          CurrencyType.SWEEP_COINS,
          `Creator Payout from bet on ${winningOption.round.roundName}`,
          queryRunner.manager,
        );
      }
    }

    platformPayout = platformPayout - creatorPayout;

    const record = this.platformPayoutRepository.create({
      bettingRoundId: winningOption.round.id,
      assignedCreatorId: creatorAssigned ? creatorAssigned.id : null,
      creator_split_pct: createSplitPct,
      platform_payout_amount: platformPayout,
      creator_split_amount: creatorPayout,
    });

    await this.platformPayoutRepository.save(record);
  }

  async getPayoutsByUserId(props: { userId: string, pagination?: { page?: number, limit?: number }}): Promise<{
    data: {
      id: string;
      createdAt: string;
      bettingRoundName: string;
      bettingRoundId: string;
      streamId: string;
      amount: number;
    }[];
    pagination: { page: number, limit: number, totalPages: number }
  }> {
    const { userId, pagination } = props;
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 10;

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const qb = this.platformPayoutRepository
      .createQueryBuilder('pp')
      .leftJoinAndSelect(BettingRound, 'round', 'pp.betting_round = round.id')
      .where('pp.assigned_creator = :userId', { userId })
      .andWhere('pp.creator_split_amount > 0')
      .orderBy('pp.createdAt', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit);

    const results = await qb.getRawMany<PlatformPayout>(); 
    const count = await qb.getCount();

    const payouts = results.map((payout) => ({
      id: payout["pp_id"],
      createdAt: payout["pp_createdAt"],
      amount: payout["pp_creator_split_amount"],
      bettingRoundName: payout["round_roundName"],
      bettingRoundId: payout["pp_betting_round"],
      streamId: payout["round_stream_id"],
    }));

    return {
      data: payouts,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      }
    };
  }
}
