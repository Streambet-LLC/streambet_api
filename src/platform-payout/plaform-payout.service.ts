import { Injectable } from '@nestjs/common';
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
    betRound: BettingRound,
    winningOption: BettingVariable,
  ): Promise<void> {
    const stream = await this.streamRepository.findOne({
      where: { id: betRound.streamId },
    });

    const creatorAssigned = await this.userRepository.findOne({
      where: {
        id: stream.creatorId ?? '',
      },
    });

    const opposingVariables = await this.bettingVariableRepository
      .createQueryBuilder()
      .where('round_id = :roundId', { roundId: betRound.id })
      .andWhere('id <> :variableId', { variableId: winningOption.id })
      .getMany();

    const totalPot = opposingVariables.reduce(
      (sum, item) => (sum += Number(item.totalBetsSweepCoinAmount)),
      0,
    );

    const initialPayout = totalPot * 0.15;
    let creatorPayout = 0;
    let createSplitPct = 0;

    if (creatorAssigned) {
      createSplitPct = creatorAssigned.revShare;
      creatorPayout = initialPayout * (createSplitPct / 100);

      if (creatorPayout > 0) {
        await this.walletsService.creditPayout(
          creatorAssigned.id,
          creatorPayout,
          CurrencyType.SWEEP_COINS,
          `Creator Payout from bet on ${betRound.roundName}`,
          queryRunner.manager,
        );
      }
    }

    let platformPayout = initialPayout - creatorPayout;

    if (winningOption.betCountSweepCoin == 0) {
      // if there is no bettor on this side, get total pot assuming there is at least 2 bettors on diff side
      platformPayout = totalPot;
      platformPayout -= creatorPayout;
    }

    if (platformPayout > 0) {
      const record = this.platformPayoutRepository.create({
        bettingRoundId: betRound.id,
        assignedCreatorId: creatorAssigned ? creatorAssigned.id : null,
        creator_split_pct: createSplitPct,
        platform_payout_amount: platformPayout,
        creator_split_amount: creatorPayout,
      });

      await this.platformPayoutRepository.save(record);
    }
  }
}
