import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { StreamEventType, StreamStatus } from 'src/enums/stream.enum';
import { BettingCategory } from 'src/enums/betting-category.enum';

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
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: BettingCategory,
    description: 'Filter Picks by category',
  })
  @IsOptional()
  @IsEnum(BettingCategory)
  category?: BettingCategory;
}
