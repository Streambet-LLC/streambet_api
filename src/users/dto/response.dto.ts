import { ApiProperty } from '@nestjs/swagger';

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
  profile_image_url: string;

  @ApiProperty({ example: null, nullable: true })
  google_id: string | null;

  @ApiProperty({ example: {}, type: Object })
  notification_preferences: string;

  @ApiProperty({ example: '2025-06-12T10:27:57.689Z' })
  tos_acceptance_timestamp: Date;

  @ApiProperty({ example: '2025-06-12' })
  account_creation_date: Date;

  @ApiProperty({ example: null, nullable: true })
  last_known_ip: string | null;

  @ApiProperty({ example: null, nullable: true })
  is_suspended: string | null;

  @ApiProperty({ example: null, nullable: true })
  is_banned: string | null;

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
}
