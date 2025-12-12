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
import { PayoutReportFilterDto } from './dto/payout-report/payout-report.requests.dto';
import { Range } from 'src/common/filters/filter.dto';

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

  async generatePayoutReport(
    payoutReportFilterDto: PayoutReportFilterDto,
  ): Promise<{ data: any[]; total: number }> {
    let data = [];
    let total = 0;

    const reportQb = this.platformPayoutRepository
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.creator', 'wallet')
      .leftJoinAndSelect('u.bettingRound', 'bettingRound')
      .leftJoinAndSelect('bettingRound.bettingVariables', 'bettingVariables')
      .leftJoinAndSelect('bettingRound.stream', 'stream')
      .orderBy('u.createdAt', 'DESC');

    const searchFilter = payoutReportFilterDto.search;
    const range: Range = payoutReportFilterDto.range
      ? (JSON.parse(payoutReportFilterDto.range) as Range)
      : [0, 10];

    if (searchFilter) {
      reportQb.andWhere(
        `(LOWER(bettingRound.roundName) ILIKE LOWER(:q) OR LOWER(stream.name) ILIKE LOWER(:q))`,
        {
          q: `%${searchFilter}%`,
        }
      );
    }

    const [offset, limit] = range;

    total = Math.ceil(
      await reportQb.getCount() / limit
    );

    reportQb.skip(offset).take(limit);
    const result = await reportQb.getMany();
    console.log(result.length);

    // Fetch paginated or full data
    data = result.map((item) => {
      return {
        id: item.id,
        stream: item.bettingRound.stream.name,
        round: item.bettingRound.roundName,
        totalSweepBets: item.bettingRound.bettingVariables.reduce((sum, bv) => {
          return sum + Number(bv.totalBetsSweepCoinAmount);
        }, 0),
        winningSideBets: item.bettingRound.bettingVariables
          .filter((bv) => bv.is_winning_option)
          .reduce((sum, bv) => {
            return sum + Number(bv.totalBetsSweepCoinAmount);
          }, 0),
        losingSideBets: item.bettingRound.bettingVariables
          .filter((bv) => !bv.is_winning_option)
          .reduce((sum, bv) => {
            return sum + Number(bv.totalBetsSweepCoinAmount);
          }, 0),
        platformPayouts: item.platform_payout_amount,
        creator: item.creator ? item.creator.username : '',
        creatorSplit: item.creator_split_pct,
        creatorSplitAmount: item.creator_split_amount,
        date: item.createdAt,
      };
    });

    console.log(data);

    return { data, total };
  }

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
}
