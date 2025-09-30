import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  MinLength,
  Matches,
  IsDefined,
} from 'class-validator';

export class ResetPasswordDto {
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
  newPassword: string;

  @ApiProperty({
    description: 'Token for the account',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  token: string;
}
