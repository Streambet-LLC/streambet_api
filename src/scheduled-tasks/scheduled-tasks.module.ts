import { Module } from '@nestjs/common';
import { AutoLockerService } from './auto-locker.service';
import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [
        TypeOrmModule.forFeature([BettingRound]),
    ],
    providers: [AutoLockerService],
})
export class ScheduledTaskModule { }