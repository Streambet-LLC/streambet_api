import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { AdminFilterDto, Range, Sort } from 'src/common/filters/filter.dto';
import { BetStatus } from 'src/enums/bet-status.enum';
import { CurrencyType } from 'src/wallets/entities/transaction.entity';

/**
 * Request query DTO for betting history listing.
 * Supports text search by stream name, range-based pagination, and date sorting.
 */
export class BetHistoryFilterDto extends AdminFilterDto {
  @ApiProperty({
    description: `
  Filter params pass the data as key value pair
  eg:
  {
    "q": <stream_name>
  }
  `,
    required: false,
    default: '{}',
  })
  @IsString()
  @IsOptional()
  public filter?: string;

  @ApiPropertyOptional({
    type: Boolean,
    default: true,
    description:
      'Pass with parameter false if you want the results without pagination',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) =>
    value && value === 'false' ? false : true,
  )
  pagination?: boolean;
}

/**
 * Single betting history row.
 */
export class BetHistoryItemDto {
  @ApiProperty({ example: '2025-07-28T04:41:14.168Z' })
  date: string;

  @ApiProperty({ example: 'Sunday Night Football' })
  streamName: string;

  @ApiProperty({ example: 'Round 1' })
  roundName: string;

  @ApiProperty({ example: 'Team A' })
  optionName: string;

  @ApiProperty({ example: CurrencyType.STREAM_COINS, enum: CurrencyType })
  coinType: string;

  @ApiProperty({ example: 50 })
  amountPlaced: number;

  @ApiProperty({ example: 120 })
  amountWon: number | null;

  @ApiProperty({ example: 50 })
  amountLost: number | null;

  @ApiProperty({ example: BetStatus.Won, enum: BetStatus })
  status: string;
}

/**
 * Response DTO for betting history listing.
 */
export class BetHistoryResponseDto {
  @ApiProperty({ example: 200 })
  status: number;

  @ApiProperty({ example: 'Successfully Listed' })
  message: string;

  @ApiProperty({ type: [BetHistoryItemDto] })
  data: BetHistoryItemDto[];

  @ApiProperty({ example: 42 })
  total: number;
}



