import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Conversation } from './conversation.entity';
import { User } from '../../users/entities/user.entity';

@Entity('conversation_participants')
export class ConversationParticipant extends BaseEntity {
  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({
    type: 'timestamp',
    nullable: true,
    name: 'last_read_at',
  })
  lastReadAt: Date;

  @Column({
    type: 'boolean',
    default: false,
    name: 'is_blocked',
  })
  isBlocked: boolean;

  @Column({
    type: 'timestamp',
    nullable: true,
    name: 'blocked_at',
  })
  blockedAt: Date;

  @ManyToOne(() => Conversation, (conversation) => conversation.participants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
