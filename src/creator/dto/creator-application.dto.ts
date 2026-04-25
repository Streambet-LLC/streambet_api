import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';

export enum ApplicationType {
  CREATOR = 'creator',
  SELLER = 'seller',
}

export class CreatorApplicationDto {
  @ApiProperty({ type: String, description: 'First Name' })
  @IsString()
  firstName: string;

  @ApiProperty({ type: String, description: 'Last Name' })
  @IsString()
  lastName: string;

  @ApiProperty({ type: String, description: 'Email' })
  @IsString()
  email: string;

  @ApiProperty({
    enum: ApplicationType,
    description: 'Application Type',
    required: false,
    default: ApplicationType.CREATOR,
  })
  @IsOptional()
  @IsEnum(ApplicationType)
  applicationType?: ApplicationType;

  // Creator-specific fields
  @ApiProperty({
    type: String,
    description: 'Socials (required for creator applications)',
    required: false,
  })
  @IsOptional()
  @IsString()
  socials?: string;

  @ApiProperty({
    type: String,
    description:
      'Application Pitch/Message (required for creator applications)',
    required: false,
  })
  @IsOptional()
  @IsString()
  message?: string;

  // Seller-specific fields
  @ApiProperty({
    type: String,
    description:
      'Tell us about yourself from a collector perspective (required for seller applications)',
    required: false,
  })
  @IsOptional()
  @IsString()
  collectorBackground?: string;

  @ApiProperty({
    type: String,
    description:
      'What city/state are you in (required for seller applications)',
    required: false,
  })
  @IsOptional()
  @IsString()
  cityState?: string;

  @ApiProperty({
    type: String,
    description:
      'What cards do you predominately collect (required for seller applications)',
    required: false,
  })
  @IsOptional()
  @IsString()
  cardsCollected?: string;

  @ApiProperty({
    type: String,
    description:
      'Do you predominately do raw cards or slabbed (required for seller applications)',
    required: false,
  })
  @IsOptional()
  @IsString()
  cardPreference?: string;

  // Status fields (read-only, populated by backend)
  @ApiProperty({
    type: String,
    description: 'Application status',
    required: false,
    enum: ['pending', 'approved', 'rejected'],
  })
  @IsOptional()
  @IsString()
  applicationStatus?: string;

  @ApiProperty({
    type: Date,
    description: 'When the application was reviewed',
    required: false,
  })
  @IsOptional()
  reviewedAt?: Date;

  @ApiProperty({
    type: String,
    description: 'User ID of the admin who reviewed this application',
    required: false,
  })
  @IsOptional()
  @IsString()
  reviewedByUserId?: string;
}
