import { ApiProperty } from '@nestjs/swagger';

export class WinnerDto {
  @ApiProperty({ example: 'streambetadmin' })
  userName: string;

  @ApiProperty({ example: 'avatar/064746d8...', nullable: true })
  userProfileUrl: string | null;
}

export class WinningOptionDto {
  @ApiProperty({ example: 'Option 2' })
  variableName: string;

  @ApiProperty({ example: '0' })
  totalSweepCoinAmt: number;

  @ApiProperty({ example: '112' })
  totalGoldCoinAmt: number;

  @ApiProperty({ type: [WinnerDto] })
  winners: WinnerDto[];
}

export class RoundDetailsDto {
  @ApiProperty({ example: 'First round' })
  roundName: string;

  @ApiProperty({ example: 'closed' })
  roundStatus: string;

  @ApiProperty({ example: '2025-08-19T08:32:34.174Z' })
  createdAt: string;

  @ApiProperty({ type: [WinningOptionDto] })
  winningOption: WinningOptionDto[];
}

export class StreamDetailsDto {
  @ApiProperty({ example: 'e8193c88-ae10-4878-8c73-daa9cfc406d0' })
  id: string;

  @ApiProperty({ example: 'queue test 3' })
  name: string;

  @ApiProperty({
    example: 'https://www.youtube.com/watch?v=8_X0nSrzrCw',
  })
  embeddedUrl: string;

  @ApiProperty({
    example: 'thumbnail/08142f2f-3894-41b0-a279-d00583963dfd-Capture.PNG',
  })
  thumbnailUrl: string;

  @ApiProperty({ example: 'youtube' })
  platformName: string;

  @ApiProperty({ example: 'live' })
  status: string;

  @ApiProperty({ example: '2025-08-11T02:00:00.000Z' })
  scheduledStartTime: Date;

  @ApiProperty({ example: '', description: 'Stream description' })
  discription: string;

  @ApiProperty({ example: 34 })
  viewerCount: number;

  @ApiProperty({ type: [RoundDetailsDto] })
  roundDetails: RoundDetailsDto[];
}

export class StreamResponseDto {
  @ApiProperty({ example: 'Stream details retrieved successfully' })
  message: string;

  @ApiProperty({ example: 200 })
  status: number;

  @ApiProperty({ type: StreamDetailsDto })
  data: StreamDetailsDto;
}
