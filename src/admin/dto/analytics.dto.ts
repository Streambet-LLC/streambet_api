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