import { ApiProperty } from '@nestjs/swagger';
import { NotificationPreference } from '../entities/user.entity';

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

  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

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

  @ApiProperty({ example: null, nullable: true })
  isSuspended: string | null;

  @ApiProperty({ example: null, nullable: true })
  isBanned: string | null;

  @ApiProperty({ example: false })
  isGoogleAccount: boolean;

  @ApiProperty({ example: 'user', enum: ['user', 'admin'] })
  role: 'user' | 'admin';

  @ApiProperty({ example: '2025-06-13T10:50:04.593Z' })
  lastLogin: Date;

  @ApiProperty({ example: true })
  tosAccepted: boolean;

  @ApiProperty({ example: null, nullable: true })
  tosAcceptedAt: Date | null;

  @ApiProperty({ example: true })
  isActive: boolean;
  @ApiProperty({ description: 'Gold Coin balance', example: 0 })
  walletBalanceGoldCoin: number;

  @ApiProperty({ description: 'Sweep coin balance', example: 0 })
  walletBalanceSweepCoin: number;
}
