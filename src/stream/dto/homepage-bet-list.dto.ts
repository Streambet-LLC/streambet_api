import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { StreamEventType, StreamStatus } from 'src/enums/stream.enum';

export class HomepageBetListDto {
  @ApiPropertyOptional({
    type: Number,
    default: 1,
  })
  @IsNumber()
  page?: number;
 
  @ApiPropertyOptional({
    type: String,
    default: "",
  })
  @IsString()
  search?: string;
}
