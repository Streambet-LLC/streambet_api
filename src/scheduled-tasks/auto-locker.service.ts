
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { now } from 'lodash-es';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { BettingRoundStatus } from 'src/enums/round-status.enum';
import { Repository } from 'typeorm';

@Injectable()
export class AutoLockerService {
    private readonly logger = new Logger(AutoLockerService.name);

    constructor(
        @InjectRepository(BettingRound)
        private bettingRoundRepository: Repository<BettingRound>,
    ) { }

    @Cron(CronExpression.EVERY_MINUTE)
    async handleCron() {
        this.logger.debug('Processing Auto Locker');

        await this.bettingRoundRepository
            .createQueryBuilder()
            .update(BettingRound)
            .where('lockDate IS NOT NULL AND lockDate < :now AND status IN (:...statuses)', {
                statuses: [
                    BettingRoundStatus.CREATED,
                    BettingRoundStatus.OPEN
                ],
                now: new Date,
            })
            .set({
                status: BettingRoundStatus.LOCKED
            })
            .execute()

        this.logger.debug('Completed Auto Locker');

    }
}
