import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Stream } from '../../stream/entities/stream.entity';

@Entity('chats')
export class Chat extends BaseEntity {
  @ManyToOne(() => Stream, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stream_id' })
  @Index()
  stream: Stream;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  @Index()
  user: User;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'image_url' })
  imageURL: string;

  //store message for place bet
  @Column({
    type: 'text',
    nullable: true,
    name: 'system_message',
  })
  systemMessage: string;

  @Column({
    type: 'timestamp',
    name: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  timestamp: Date;
} 