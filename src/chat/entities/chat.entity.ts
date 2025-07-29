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

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'image_url' })
  imageURL: string;

  @Column({ type: 'timestamp', name: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  timestamp: Date;
} 