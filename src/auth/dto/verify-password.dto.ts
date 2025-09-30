import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNotEmpty, IsString } from 'class-validator';

export class userVerificationDto {
  @ApiProperty({
    description: 'Token for the account',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  token: string;
}
