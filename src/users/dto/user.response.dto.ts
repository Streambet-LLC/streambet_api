import { ApiProperty } from '@nestjs/swagger';
import { NotificationPreference } from '../entities/user.entity';
import { UserRole } from 'src/enums/user-role.enum';
import { IsOptional } from 'class-validator';
import { PrizeProgressDto } from 'src/prize/dto';

export class PublicUserProfileDto {
  @ApiProperty({ example: '0b9f2a90-c43d-493d-b55d-d89455d35744' })
  id: string;

  @ApiProperty({ example: 'johndoe' })
  username: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  accountCreationDate: Date;

  @ApiProperty({ example: 'https://example.com/avatar.png' })
  profileImageUrl: string;

  @ApiProperty({ 
    example: { twitter: '@johndoe', youtube: 'johndoe123' }, 
    nullable: true,
    description: 'Social media links' 
  })
  socials: { [social: string]: string } | null;

  @ApiProperty({ enum: UserRole, example: UserRole.USER })
  role: UserRole;

  @ApiProperty({ example: true, description: 'Whether the requesting user follows this profile' })
  isFollowed: boolean;

  @ApiProperty({ example: 1250, description: 'Total follower count' })
  followers: number;

  @ApiProperty({ example: 500, description: 'Current Cade Coins balance' })
  currentCadeCoins: number;

  @ApiProperty({ example: 15000, description: 'Lifetime Cade Coins earned' })
  lifetimeCadeCoins: number;

  @ApiProperty({ example: 'Master', description: 'Current achievement title' })
  title: string;

  @ApiProperty({ example: 'Dealer', description: 'Current badge level' })
  badgeLevel: string;

  @ApiProperty({ type: PrizeProgressDto, description: 'Prize progression details' })
  prizeProgress: PrizeProgressDto;

  @ApiProperty({ required: false, example: true, description: 'Whether user is a creator' })
  isCreator?: boolean;
}

export class UserProfileResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  role: string;

  @ApiProperty()
  profileImageUrl: string;

  @ApiProperty()
  lastKnownIP: string;

  @ApiProperty()
  isActive?: boolean;

  @ApiProperty({ type: Number, example: 100 })
  minWithdrawableSweepCoins: number;

  @ApiProperty({ type: Number, example: 10 })
  sweepCoinsPerDollar: number;

  @ApiProperty({ type: Number, example: 50, description: 'Maximum allowed bet amount for sweep coins' })
  maxSweepCoinsBet: number;

  @ApiProperty({ type: Number, example: 1000, description: 'Maximum allowed bet amount for gold coins' })
  maxGoldCoinsBet: number;
}

export class UserResponseDto {
  @ApiProperty({ example: '0b9f2a90-c43d-493d-b55d-d89455d35744' })
  id: string;

  @ApiProperty({ example: '2025-06-12T10:27:57.697Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-06-13T10:50:04.596Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'johndoe' })
  username: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

  @ApiProperty({ example: 'California', nullable: true })
  state: string | null;

  @ApiProperty({
    example: 'https://example.com/images/avatar.png',
    nullable: true,
  })
  profileImageUrl: string;

  @ApiProperty({ example: null, nullable: true })
  googleId: string | null;

  @ApiProperty({ example: {}, type: NotificationPreference })
  notificationPreferences: NotificationPreference;

  @ApiProperty({ example: '2025-06-12T10:27:57.689Z' })
  tosAcceptanceTimestamp: Date;

  @ApiProperty({ example: '2025-06-12' })
  accountCreationDate: Date;

  @ApiProperty({ example: null, nullable: true })
  lastKnownIp: string | null;

  @ApiProperty({ example: 'WELCOME2025', nullable: true })
  promoCode: string | null;

  @ApiProperty({ example: null, nullable: true })
  isSuspended: string | null;

  @ApiProperty({ example: null, nullable: true })
  isBanned: string | null;

  @ApiProperty({ example: false })
  isGoogleAccount: boolean;

  @ApiProperty({ example: false })
  isCreator: boolean;

  @ApiProperty({ example: UserRole.USER, enum: UserRole })
  role: UserRole;

  @ApiProperty({ example: '2025-06-13T10:50:04.593Z' })
  lastLogin: Date;

  @ApiProperty({
    description: 'Socials of the user',
  })
  socials: { [social: string]: string } | null;

  @ApiProperty({ example: true })
  tosAccepted: boolean;

  @ApiProperty({ example: null, nullable: true })
  tosAcceptedAt: Date | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: true })
  @IsOptional()
  isFollowed?: boolean;

  @ApiProperty({ example: 10 })
  @IsOptional()
  followers?: number;

  @ApiProperty({ description: 'Gold Coin balance', example: 0 })
  walletBalanceGoldCoin: number;

  @ApiProperty({ description: 'Stream Coin balance', example: 0 })
  walletBalanceSweepCoin: number;

  @ApiProperty({ description: 'Withdrawable Stream Coin balance', example: 0 })
  withdrawableBalanceSweepCoin: number;
}
