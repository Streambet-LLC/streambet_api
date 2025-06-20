import { IsDefined, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    description: 'Enter username or email to login',
  })
  @IsString()
  @IsNotEmpty({ message: 'Username or email must not be empty.' })
  @IsDefined({ message: 'Username or email is required.' })
  identifier: string;

  @ApiProperty({
    description: 'Enter Password to login',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password must not be empty.' })
  @IsDefined({ message: 'Password is required.' })
  password: string;

  @ApiProperty({
    description: 'Set to true to keep the user logged in for 30 days',
    required: false,
    default: false,
  })
  remember_me?: boolean;
}
