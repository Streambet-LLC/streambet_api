import { IsOptional } from 'class-validator';
import {
  Column,
  Entity,
} from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';

@Entity('live_feed_updates')
export class LiveFeedUpdate extends BaseEntity {
  @Column({ name: 'type' })
  type: string;

  @Column({ name: 'username' })
  @IsOptional()
  username?: string;

  @Column({ name: 'stream' })
  @IsOptional()
  stream?: string;

  @Column({ name: 'round' })
  @IsOptional()
  round?: string;

  @Column({ name: 'option' })
  @IsOptional()
  option?: string;

  @Column({ name: 'amount' })
  @IsOptional()
  amount?: number;

  @Column({ name: 'ranking' })
  @IsOptional()
  ranking?: number;
}
