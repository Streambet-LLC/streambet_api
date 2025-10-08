import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column } from 'typeorm';

@Entity('webhook')
export class Webhook extends BaseEntity {
  @Column({ length: 255, type: 'varchar' })
  provider: string;

  @Column({ type: 'text' })
  data: string;
}
