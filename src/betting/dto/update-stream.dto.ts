import {
  IsOptional,
  IsString,
  IsUrl,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StreamStatus } from 'src/enums/stream.enum';

export class UpdateStreamDto {
  @ApiProperty({
    description: 'The name of the stream',
    example: 'Champions League Final - Real Madrid vs Barcelona',
    type: 'string',
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'A description of the stream',
    example: 'Live coverage of the Champions League final match',
    type: 'string',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'The embedded URL for the stream (YouTube, Twitch, etc.)',
    example: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    type: 'string',
    format: 'uri',
    required: false,
  })
  @IsUrl()
  @IsOptional()
  embeddedUrl?: string;

  @ApiProperty({
    description: 'URL to the stream thumbnail image',
    example: 'https://example.com/thumbnail.jpg',
    type: 'string',
    format: 'uri',
    required: false,
  })
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @ApiProperty({
    description: 'Status of the stream',
    enum: StreamStatus,
    example: StreamStatus.LIVE,
    required: false,
  })
  @IsEnum(StreamStatus)
  @IsOptional()
  status?: StreamStatus;

  @ApiProperty({
    description: 'Scheduled start time of the stream',
    example: '2024-01-01T20:00:00Z',
    type: 'string',
    format: 'date-time',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  scheduledStartTime?: string;

  @ApiProperty({
    description: 'UUID of Creator',
  })
  @IsOptional()
  creatorId?: string;
}
