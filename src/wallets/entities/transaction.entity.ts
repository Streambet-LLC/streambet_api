import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { TransactionType } from 'src/enums/transaction-type.enum';
import { CurrencyType } from 'src/enums/currency.enum';

@Entity('transactions')
export class Transaction extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: TransactionType,
  })
  type: TransactionType;

  @Column({
    type: 'enum',
    enum: CurrencyType,
  })
  currencyType: CurrencyType;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    nullable: true,
  })
  amount: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    nullable: true,
  })
  balanceAfter: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;
  
  @Column({ type: 'varchar', length: 500, nullable: true })
  relatedEntityId: string;

  @Column({ nullable: true })
  relatedEntityType: string;
}
