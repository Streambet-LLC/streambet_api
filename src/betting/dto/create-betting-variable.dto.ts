import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsArray,
  ValidateNested,
  IsOptional,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { BettingRoundStatus } from 'src/enums/round-status.enum';
import { BettingCategory } from 'src/enums/betting-category.enum';

export class OptionDto {
  @ApiProperty({
    description: 'The name of the betting option',
    example: 'Team A Wins',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  option: string;
}

export class EditOptionDto {
  @ApiProperty({
    description: 'The ID of the existing option (optional for new options)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: 'string',
    format: 'uuid',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  id?: string; // Optional for existing options

  @ApiProperty({
    description: 'The name of the betting option',
    example: 'Team A Wins',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  option: string;
}

export class RoundDto {
  @ApiProperty({
    description: 'The name of the betting round',
    example: 'Round 1 - First Half',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  roundName: string;

  @ApiProperty({
    description: 'Optional Lock Date',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  lockDate?: string;

  @ApiProperty({
    description: 'Category of the Pick round',
    enum: BettingCategory,
    example: BettingCategory.SPORTS,
    required: false,
  })
  @IsOptional()
  @IsEnum(BettingCategory)
  category?: BettingCategory;

  @ApiProperty({
    description: 'Array of betting options for this round',
    type: [OptionDto],
    example: [
      { option: 'Team A Wins' },
      { option: 'Team B Wins' },
      { option: 'Draw' },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionDto)
  options: OptionDto[];
}

export class EditRoundDto {
  @ApiProperty({
    description: 'The ID of the existing round (optional for new rounds)',
    example: '222e3333-e44b-55d3-a456-426614174002',
    type: 'string',
    format: 'uuid',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  roundId?: string;

  @ApiProperty({
    description: 'The name of the betting round',
    example: 'Round 1 - First Half',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  roundName: string;

  @ApiProperty({
    description: 'Optional Lock Date',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  lockDate?: string;

  @ApiProperty({
    description: 'Category of the Pick round',
    enum: BettingCategory,
    example: BettingCategory.SPORTS,
    required: false,
  })
  @IsOptional()
  @IsEnum(BettingCategory)
  category?: BettingCategory;

  @ApiProperty({
    description:
      'Array of betting options for this round (can include existing and new options)',
    type: [EditOptionDto],
    example: [
      { id: '123e4567-e89b-12d3-a456-426614174000', option: 'Team A Wins' },
      { option: 'Team B Wins' },
      { option: 'Draw' },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditOptionDto)
  options: EditOptionDto[];
}

export class CreateBettingVariableDto {
  @ApiProperty({
    description: 'The ID of the stream to create betting variables for',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  streamId: string;

  @ApiProperty({
    description: 'Array of betting rounds with their options',
    type: [RoundDto],
    example: [
      {
        roundName: 'Round 1 - First Half',
        options: [
          { option: 'Team A Wins' },
          { option: 'Team B Wins' },
          { option: 'Draw' },
        ],
      },
      {
        roundName: 'Round 2 - Second Half',
        options: [{ option: 'Over 2.5 Goals' }, { option: 'Under 2.5 Goals' }],
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoundDto)
  rounds: RoundDto[];
}

export class EditBettingVariableDto {
  @ApiProperty({
    description: 'The ID of the stream to edit betting variables for',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  streamId: string;

  @ApiProperty({
    description:
      'Array of betting rounds with their options (can include existing and new options)',
    type: [EditRoundDto],
    example: [
      {
        roundName: 'Round 1 - First Half',
        options: [
          { id: '123e4567-e89b-12d3-a456-426614174000', option: 'Team A Wins' },
          { option: 'Team B Wins' },
          { option: 'Draw' },
        ],
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditRoundDto)
  rounds: EditRoundDto[];
}

export class UpdateRoundStatusDto {
  @ApiProperty({
    description: 'The new status for the round',
    enum: [
      BettingRoundStatus.CREATED,
      BettingRoundStatus.OPEN,
      BettingRoundStatus.LOCKED,
    ],
    example: BettingRoundStatus.OPEN,
  })
  @IsString()
  @IsNotEmpty()
  newStatus: 'created' | 'open' | 'locked';
}
