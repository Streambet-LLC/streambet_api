import { ApiProperty } from "@nestjs/swagger";

export class AnalyticsSummaryResponseDto {
  @ApiProperty({ type: Number, description: 'Total views' })
  totalViews: number;

  @ApiProperty({ type: Number, description: 'Total number of streams' })
  totalStreams: number;

  @ApiProperty({ type: String, description: 'Total live time in HH:mm:ss format' })
  totalLiveTime: string;
}

export class StreamAnalyticsResponseDto {
  @ApiProperty({
    type: Number,
    description: 'Total number of users watching stream',
  })
  totalUsers: number;

  @ApiProperty({
    type: 'object',
    description:
      'Total bet value for the stream, separated by Gold Coin and Stream Coins',
    properties: {
      goldCoins: {
        type: 'number',
        description: 'Total bet value in Gold Coin',
      },
      sweepCoins: {
        type: 'number',
        description: 'Total bet value in Stream Coins',
      },
    },
  })
  totalBetValue: {
    goldCoins: number;
    sweepCoins: number;
  };

  @ApiProperty({
    type: String,
    description: 'Total stream time (formatted as HHh MMm SSs)',
  })
  totalStreamTime: string;

  @ApiProperty({
    type: String,
    description: 'Platform vig/commission (as a percentage string)',
  })
  platformVig: string;

  @ApiProperty({
    type: Number,
    description: 'Total number of users placed bet on this stream',
  })
  totalBetPlacedUsers: number;
}