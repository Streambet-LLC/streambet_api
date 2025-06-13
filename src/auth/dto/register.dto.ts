import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  Matches,
  IsBoolean,
  IsDefined,
  IsOptional,
  IsIP,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    description: 'Email address of the user',
    example: 'john.doe@example.com',
  })
  @IsNotEmpty()
  @IsDefined()
  @IsEmail()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.toLowerCase().trim();
    }
    return value as string;
  })
  email: string;

  @ApiProperty({
    description: 'Password for the account',
    example: 'StrongP@ss123',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  @MinLength(8, {
    message: 'Password must be at least 8 characters long',
  })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character',
  })
  password: string;

  @ApiProperty({
    description: 'Username of the user',
    example: 'johndoe',
  })
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      'Username can only contain alphanumeric characters, underscores, and hyphens',
  })
  username: string;

  @ApiProperty({
    description: 'Profile url of the user',
  })
  @IsOptional()
  @IsString()
  profileImageUrl?: string;

  @ApiProperty({
    description: 'Confirmation that the user is older than  18 years',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  isOlder: boolean;

  @ApiProperty({
    description: 'Confirmation that the user accepts the Terms of Service',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  tosAccepted: boolean;

  @ApiProperty({
    description: 'Last known IP address for geolocation',
  })
  @IsOptional()
  @IsIP()
  lastKnownIP?: string;
}

export class UserRegistrationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  role: string;
}
