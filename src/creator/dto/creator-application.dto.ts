import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

/**
 * Application type kept as an enum for forward-compatibility, but only SELLER
 * is supported now (creator role removed in Phase 3 cleanup).
 */
export enum ApplicationType {
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
    type: String,
    description:
      'Social handles / links the applicant trades cards on (free-form text)',
    required: false,
  })
  @IsOptional()
  @IsString()
  socials?: string;

  @ApiProperty({
    enum: ApplicationType,
    description: 'Application type (only "seller" is supported)',
    required: false,
  })
  @IsOptional()
  @IsString()
  applicationType?: ApplicationType;

  @ApiProperty({
    type: String,
    description: 'Tell us about yourself from a collector perspective',
    required: false,
  })
  @IsOptional()
  @IsString()
  collectorBackground?: string;

  @ApiProperty({
    type: String,
    description: 'What city/state are you in',
    required: false,
  })
  @IsOptional()
  @IsString()
  cityState?: string;

  @ApiProperty({
    type: String,
    description: 'What cards do you predominately collect',
    required: false,
  })
  @IsOptional()
  @IsString()
  cardsCollected?: string;

  @ApiProperty({
    type: String,
    description: 'Do you predominately do raw cards or slabbed',
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
