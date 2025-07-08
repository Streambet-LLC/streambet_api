import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsDefined, IsNotEmpty, IsString } from 'class-validator';

export class AddMessageDto {
  @ApiProperty()
  @IsString()
  @IsDefined()
  @IsNotEmpty()
  body: string;
  @ApiProperty()
  @IsString()
  @IsDefined()
  @IsNotEmpty()
  author: string;
}
