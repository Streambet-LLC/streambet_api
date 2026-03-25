import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, OneToMany } from 'typeorm';
import { ConversationParticipant } from './conversation-participant.entity';
import { Message } from './message.entity';

export enum ConversationType {
  DIRECT = 'direct',
  SUPPORT = 'support',
}

@Entity('conversations')
export class Conversation extends BaseEntity {
  @Column({
    type: 'enum',
    enum: ConversationType,
    default: ConversationType.DIRECT,
  })
  type: ConversationType;

  @Column({ length: 255, type: 'varchar', nullable: true })
  subject: string;

  @OneToMany(
    () => ConversationParticipant,
    (participant) => participant.conversation,
    { eager: true },
  )
  participants: ConversationParticipant[];

  @OneToMany(() => Message, (message) => message.conversation)
  messages: Message[];
}
