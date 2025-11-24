import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { StreamEventType, StreamStatus } from 'src/enums/stream.enum';

export class CreatorProfileNonVideoBetsDto {
  @ApiPropertyOptional({
    type: Number,
    default: 1,
  })
  @IsNumber()
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({
    type: Number,
    default: 4,
  })
  @IsNumber()
  @IsOptional()
  limit?: number;

  @IsString()
  username: string;
}
