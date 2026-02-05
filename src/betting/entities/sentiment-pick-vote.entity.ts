import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { BettingRound } from './betting-round.entity';

@Entity('sentiment_pick_votes')
@Unique(['user', 'bettingRound'])
@Index('IDX_sentiment_pick_votes_userId', ['user'])
@Index('IDX_sentiment_pick_votes_bettingRoundId', ['bettingRound'])
export class SentimentPickVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column('uuid')
  bettingRoundId: string;

  @ManyToOne(() => BettingRound, { eager: false })
  @JoinColumn({ name: 'bettingRoundId' })
  bettingRound: BettingRound;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
