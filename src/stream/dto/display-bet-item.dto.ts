import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  IsObject,
} from 'class-validator';
import { StreamStatus } from 'src/enums/stream.enum';
import { BettingCategory } from 'src/enums/betting-category.enum';
import { BetRoundType } from 'src/enums/bet-round-type';
import { PickMechanism } from 'src/enums/pick-mechanism.enum';

export class BetOptionDto {
  @ApiProperty({
    description: 'The ID of the betting variable/option',
    example: 'uuid-123',
  })
  @IsString()
  id: string;

  @ApiProperty({
    description: 'The name/label of the option',
    example: 'Option A',
  })
  @IsString()
  option: string;

  @ApiProperty({
    description: 'The percentage of bets on this option',
    example: '45.50',
  })
  @IsString()
  percentage: string;

  @ApiProperty({
    description: 'Whether this option is the winning option',
    example: false,
  })
  isWinner: boolean;

  @ApiPropertyOptional({
    description: 'The user bet on this option (if user is authenticated)',
    example: { amount: 100, currency: 'CADE_COINS' },
  })
  @IsOptional()
  @IsObject()
  userBet?: {
    amount: number;
    currency: string;
  } | null;
}

export class BetPotDto {
  @ApiProperty({
    description: 'Total stream coins in the pot',
    example: 1000,
  })
  @IsNumber()
  streamCoins: number;

  @ApiProperty({
    description: 'Total gold coins in the pot',
    example: 500,
  })
  @IsNumber()
  goldCoins: number;

  @ApiProperty({
    description: 'Total cade coins in the pot',
    example: 250,
  })
  @IsNumber()
  cadeCoins: number;
}

export class DisplayBetItemDto {
  @ApiProperty({
    description: 'The ID of the stream',
    example: 'stream-uuid-123',
  })
  @IsString()
  streamId: string;

  @ApiPropertyOptional({
    description: 'The ID of the betting round',
    example: 'round-uuid-123',
  })
  @IsOptional()
  @IsString()
  roundId?: string;

  @ApiProperty({
    description: 'The thumbnail URL of the stream',
    example: 'https://example.com/image.jpg',
  })
  @IsString()
  thumbnail: string;

  @ApiPropertyOptional({
    description: 'The date when the bet round locks',
  })
  @IsOptional()
  lockDate?: Date;

  @ApiProperty({
    description: 'The username of the stream creator',
    example: 'creator_username',
  })
  @IsString()
  creator: string;

  @ApiProperty({
    description: 'The name of the stream',
    example: 'Live Gaming Session',
  })
  @IsString()
  streamName: string;

  @ApiProperty({
    description: 'The name of the betting round',
    example: 'Round 1: Who will win?',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'The type of stream (e.g., stream, non-video, etc.)',
    example: 'stream',
  })
  @IsString()
  type: string;

  @ApiProperty({
    description: 'The type of betting round',
    example: BetRoundType.PICK,
    enum: BetRoundType,
  })
  @IsEnum(BetRoundType)
  betRoundType: BetRoundType;

  @ApiProperty({
    description: 'The current status of the stream',
    example: StreamStatus.LIVE,
    enum: StreamStatus,
  })
  @IsEnum(StreamStatus)
  streamStatus: StreamStatus;

  @ApiPropertyOptional({
    description: 'The scheduled start time of the stream',
  })
  @IsOptional()
  scheduledStartTime?: Date;

  @ApiProperty({
    description: 'The category of the betting round',
    example: BettingCategory.OTHER,
    enum: BettingCategory,
  })
  @IsEnum(BettingCategory)
  category: BettingCategory;

  @ApiProperty({
    description: 'The available betting options',
    type: [BetOptionDto],
  })
  @IsArray()
  options: BetOptionDto[];

  @ApiProperty({
    description: 'The total amount of coins in the betting pot',
    type: BetPotDto,
  })
  @IsObject()
  totalPot: BetPotDto;

  @ApiProperty({
    description: 'The count of users who have bet with CADE coins',
    example: 42,
  })
  @IsNumber()
  cadeCoinUsersCount: number;

  @ApiPropertyOptional({
    description: 'The description of the stream',
    example: 'Join us for an exciting gaming session!',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'The mechanism used for this betting round (e.g., default or sentiment-based)',
    example: PickMechanism.DEFAULT,
    enum: PickMechanism,
  })
  @IsOptional()
  @IsEnum(PickMechanism)
  mechanism?: PickMechanism;
}
