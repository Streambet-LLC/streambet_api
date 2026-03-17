import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Message } from './message.entity';

@Entity('message_attachments')
export class MessageAttachment extends BaseEntity {
  @Column({ type: 'uuid', name: 'message_id' })
  messageId: string;

  @Column({ type: 'varchar', length: 1000, name: 'file_url' })
  fileUrl: string;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName: string;

  @Column({ type: 'varchar', length: 100, name: 'mime_type' })
  mimeType: string;

  @Column({ type: 'integer', name: 'file_size' })
  fileSize: number;

  @ManyToOne(() => Message, (message) => message.attachments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'message_id' })
  message: Message;
}
