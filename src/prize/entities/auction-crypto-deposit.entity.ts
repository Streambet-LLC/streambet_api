import { Entity, Column, ManyToOne, JoinColumn, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Auction } from './auction.entity';
import { User } from '../../users/entities/user.entity';

export type CryptoDepositStatus = 'held' | 'refunded' | 'settled';

/**
 * Off-chain mirror of a bidder's `BidEscrow` on the hermes-auctions program.
 * One row per (auction, user); a refunded escrow is re-opened in place when
 * the bidder deposits again. `amount_usd` is only ever raised from a
 * verified on-chain balance, never from client input.
 */
@Entity('auction_crypto_deposits')
@Unique('UQ_auction_crypto_deposits_auction_user', ['auctionId', 'userId'])
@Index('IDX_auction_crypto_deposits_status', ['status'])
export class AuctionCryptoDeposit extends BaseEntity {
  @Column({ type: 'uuid', name: 'auction_id' })
  auctionId: string;

  @ManyToOne(() => Auction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'auction_id' })
  auction: Auction;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 64, name: 'wallet' })
  wallet: string;

  /** BidEscrow PDA address. */
  @Column({ type: 'varchar', length: 64, name: 'escrow_address' })
  escrowAddress: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'amount_usd',
    default: 0,
  })
  amountUsd: string;

  @Column({ type: 'varchar', length: 16, name: 'status', default: 'held' })
  status: CryptoDepositStatus;

  @Column({ type: 'jsonb', name: 'deposit_signatures', default: () => "'[]'" })
  depositSignatures: string[];

  @Column({
    type: 'varchar',
    length: 128,
    name: 'refund_signature',
    nullable: true,
  })
  refundSignature: string | null;

  @Column({
    type: 'varchar',
    length: 128,
    name: 'settle_signature',
    nullable: true,
  })
  settleSignature: string | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'settled_amount_usd',
    nullable: true,
  })
  settledAmountUsd: string | null;
}
