import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { BettingRoundStatus } from 'src/enums/round-status.enum';
import { PickMechanism } from 'src/enums/pick-mechanism.enum';

@Injectable()
export class SentimentRevealService {
  private readonly logger = new Logger(SentimentRevealService.name);

  constructor(
    @InjectRepository(BettingRound)
    private bettingRoundRepository: Repository<BettingRound>,
  ) {}

  /**
   * Runs every day at 7:00 AM PST (15:00 UTC)
   * Reveals sentiment picks and transitions them from CREATED to OPEN status
   */
  @Cron('0 15 * * *', {
    timeZone: 'America/Los_Angeles',
  })
  async revealSentimentPicks() {
    this.logger.debug('Starting sentiment pick reveal process');

    const now = new Date();

    try {
      // Find all sentiment picks that should be revealed
      const picksToReveal = await this.bettingRoundRepository.find({
        where: {
          mechanism: PickMechanism.SENTIMENT,
          status: BettingRoundStatus.CREATED,
          firstRevealTime: LessThan(now),
        },
      });

      this.logger.debug(
        `Found ${picksToReveal.length} sentiment picks to reveal`,
      );

      // Transition picks from CREATED to OPEN
      for (const pick of picksToReveal) {
        pick.status = BettingRoundStatus.OPEN;
        await this.bettingRoundRepository.save(pick);
        this.logger.log(
          `Revealed sentiment pick: ${pick.roundName} (ID: ${pick.id})`,
        );
      }

      // Handle transition from initial reveal period to real-time updates
      await this.transitionToRealTime();

      this.logger.debug('Completed sentiment pick reveal process');
    } catch (error) {
      this.logger.error('Error during sentiment pick reveal', error);
    }
  }

  /**
   * Transitions sentiment picks from initial 24-hour reveal period to real-time updates
   * This happens when firstRevealTime + 24 hours has passed
   */
  private async transitionToRealTime() {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    try {
      // Find picks that completed their first 24 hours
      const picksToTransition = await this.bettingRoundRepository.find({
        where: {
          mechanism: PickMechanism.SENTIMENT,
          isInitialRevealPeriod: true,
          firstRevealTime: LessThan(twentyFourHoursAgo),
        },
      });

      this.logger.debug(
        `Found ${picksToTransition.length} sentiment picks to transition to real-time`,
      );

      for (const pick of picksToTransition) {
        pick.isInitialRevealPeriod = false;
        pick.lastRevealTime = now;
        await this.bettingRoundRepository.save(pick);
        this.logger.log(
          `Transitioned pick to real-time: ${pick.roundName} (ID: ${pick.id})`,
        );
      }
    } catch (error) {
      this.logger.error('Error during real-time transition', error);
    }
  }
}
