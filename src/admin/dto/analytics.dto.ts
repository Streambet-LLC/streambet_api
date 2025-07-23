import { ApiProperty } from "@nestjs/swagger";

export class AnalyticsSummaryResponseDto {
  @ApiProperty({ type: Number, description: 'Total number of users' })
  totalUsers: number;

  @ApiProperty({ type: Number, description: 'Total number of active streams' })
  totalActiveStreams: number;

  @ApiProperty({ type: Number, description: 'Total number of active bets' })
  totalActiveBets: number;

  @ApiProperty({ type: Number, description: 'Total number of live streams' })
  totalLiveStreams: number;

  @ApiProperty({ type: String, description: 'Total live time in HH:mm:ss format' })
  totalLiveTime: string;
}

export class StreamAnalyticsResponseDto {
  @ApiProperty({ type: Number, description: 'Total number of users watching stream' })
  totalUsers: number;

  @ApiProperty({
    type: 'object',
    description: 'Total bet value for the stream, separated by freeTokens and coins',
    properties: {
      freeTokens: { type: 'number', description: 'Total bet value in free tokens' },
      coins: { type: 'number', description: 'Total bet value in coins' },
    },
  })
  totalBetValue: {
    freeTokens: number;
    coins: number;
  };

  @ApiProperty({ type: String, description: 'Total stream time (formatted as HHh MMm SSs)' })
  totalStreamTime: string;

  @ApiProperty({ type: String, description: 'Platform vig/commission (as a percentage string)' })
  platformVig: string;

  @ApiProperty({ type: Number, description: 'Total number of users placed bet on this stream' })
  totalBetPlacedUsers: number;
}