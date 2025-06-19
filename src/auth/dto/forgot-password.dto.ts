import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Email address or username of the user',
    example: 'user@example.com or username',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  identifier: string;
}
