import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class WinnerAmountDto {
  @ApiProperty({ description: 'Type of coin (e.g., goldCoin, sweepCoin)' })
  @IsString()
  coinType: string;

  @ApiProperty({ description: 'Amount won in this coin type', example: '100' })
  @IsString()
  @IsNumberString()
  amount: string;
}

export class WinnerDto {
  @ApiProperty({ description: 'Unique identifier of the winner' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Name of the winner' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({
    description: 'Winning amount details',
    type: [WinnerAmountDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WinnerAmountDto)
  amounts: WinnerAmountDto[];
}

export class OptionDto {
  @ApiProperty({ description: 'Unique identifier of the option' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Name of the option' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Status of the option (e.g., active, inactive)' })
  @IsString()
  status: string;

  @ApiProperty({ description: 'Whether this is the winning option' })
  @IsOptional()
  is_winning_option?: boolean;

  @ApiProperty({ description: 'Total sweep coin bet amount', example: '0' })
  @IsNumberString()
  totalBetsSweepCoinAmount: string;

  @ApiProperty({ description: 'Total gold coin bet amount', example: '0' })
  @IsNumberString()
  totalBetsGoldCoinAmount: string;

  @ApiProperty({ description: 'Number of sweep coin bets placed', example: 0 })
  @IsInt()
  @Min(0)
  betCountSweepCoin: number;

  @ApiProperty({ description: 'Number of gold coin bets placed', example: 0 })
  @IsInt()
  @Min(0)
  betCountGoldCoin: number;
}

export class RoundDto {
  @ApiProperty({ description: 'Unique identifier of the round' })
  @IsUUID()
  roundId: string;

  @ApiProperty({ description: 'Name of the round' })
  @IsString()
  roundName: string;

  @ApiProperty({
    description: 'Status of the round (e.g., created, ongoing, ended)',
  })
  @IsString()
  status: string;

  @ApiProperty({
    description: 'Total winning amounts',
    type: [WinnerAmountDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WinnerAmountDto)
  winnerAmount: WinnerAmountDto[];

  @ApiProperty({
    description: 'List of winners for this round',
    type: [WinnerDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WinnerDto)
  winners: WinnerDto[];

  @ApiProperty({
    description: 'List of options for this round',
    type: [OptionDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionDto)
  options: OptionDto[];
}

export class StreamRoundsResponseDto {
  @ApiProperty({ description: 'Unique identifier of the stream' })
  @IsUUID()
  streamId: string;

  @ApiProperty({ description: 'List of rounds', type: [RoundDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoundDto)
  rounds: RoundDto[];
}
