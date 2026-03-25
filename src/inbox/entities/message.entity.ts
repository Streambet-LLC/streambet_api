import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Conversation } from './conversation.entity';
import { User } from '../../users/entities/user.entity';
import { MessageAttachment } from './message-attachment.entity';

@Entity('messages')
export class Message extends BaseEntity {
  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  @Column({ type: 'uuid', name: 'sender_id' })
  senderId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'boolean',
    default: false,
    name: 'is_admin_message',
  })
  isAdminMessage: boolean;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'admin_name',
  })
  adminName: string;

  @Column({
    type: 'boolean',
    default: false,
    name: 'has_read_receipt',
  })
  hasReadReceipt: boolean;

  @Column({
    type: 'timestamp',
    nullable: true,
    name: 'read_at',
  })
  readAt: Date;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @OneToMany(() => MessageAttachment, (attachment) => attachment.message, {
    eager: true,
  })
  attachments: MessageAttachment[];
}
