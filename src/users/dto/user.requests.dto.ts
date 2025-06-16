import { IsString, MinLength, Matches, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';

export class ProfileUpdateDto {
  @ApiProperty({
    description: 'Name of the user',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: 'City of the user',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({
    description: 'State of the user',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({
    description: 'Username of the user',
    example: 'johndoe',
  })
  @IsString()
  @IsOptional()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      'Username can only contain alphanumeric characters, underscores, and hyphens',
  })
  username?: string;

  @ApiProperty({
    description: 'Currnet Password for the account',
    example: 'StrongP@ss123',
    minLength: 8,
  })
  @IsString()
  @IsOptional()
  @MinLength(8, {
    message: 'Current Password must be at least 8 characters long',
  })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Current Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character',
  })
  currentPassword?: string;

  @ApiProperty({
    description: 'New Password for the account',
    example: 'StrongP@ss123',
    minLength: 8,
  })
  @IsString()
  @IsOptional()
  @MinLength(8, {
    message: 'New Password must be at least 8 characters long',
  })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'New Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character',
  })
  newPassword?: string;

  @ApiProperty({
    description: 'Profile url of the user',
  })
  @IsOptional()
  @IsString()
  profileImageUrl?: string;

  @Exclude()
  @IsOptional()
  password?: string;
}
