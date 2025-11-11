import {
  IsNotEmpty,
  IsString,
  IsUrl,
  IsOptional,
  IsDateString,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StreamEventType } from 'src/enums/stream.enum';

export class CreateStreamDto {
  @ApiProperty({
    description: 'The name of the event',
    example: 'Champions League Final - Real Madrid vs Barcelona',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The type of event',
  })
  @IsNotEmpty()
  type: StreamEventType;

  @ApiProperty({
    description: 'A description of the stream',
    example: 'Live coverage of the Champions League final match',
    type: 'string',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ValidateIf(o => o.type === StreamEventType.STREAM)
  @ApiProperty({
    description: 'The embedded URL for the stream (YouTube, Twitch, etc.)',
    example: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    type: 'string',
    format: 'uri',
  })
  @IsUrl()
  @IsNotEmpty()
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

  @ValidateIf(o => o.type === StreamEventType.STREAM)
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
    description: 'End time of the stream',
    example: '2024-01-01T22:00:00Z',
    type: 'string',
    format: 'date-time',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  endTime?: string;

  @ApiProperty({
    description: 'UUID of Creator',
  })
  @IsOptional()
  creatorId?: string;
}
