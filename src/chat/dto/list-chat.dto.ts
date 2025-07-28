import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ChatMessagesFilterDto {
  @ApiProperty({
    required: true,
    description: 'The ID of the stream',
  })
  @IsString()
  streamId: string;

  @ApiProperty({
    required: false,
    default: '[0,20]',
    description: 'Pagination range as [offset, limit], e.g. [0,20]',
  })
  @IsString()
  @IsOptional()
  range?: string;

  @ApiProperty({
    required: false,
    default: '["createdAt","DESC"]',
    description: 'Sort order for the list, eg: ["createdAt","DESC"]',
  })
  @IsString()
  @IsOptional()
  public sort?: string;
}

class UserDto {
  @ApiProperty({ example: 'streambetadmin' })
  username: string;

  @ApiProperty({ example: 'admin@streambet.com' })
  email: string;

  @ApiProperty({ example: 'https://example.com/profile.jpg', required: false })
  profile_image_url?: string;
}

export class ChatMessageDto {
  @ApiProperty({ example: '96332764-7e86-43de-88fe-c460b569558c' })
  id: string;

  @ApiProperty({ example: '2025-07-28T04:41:14.168Z' })
  createdAt: string;

  @ApiProperty({ example: '2025-07-28T04:41:14.168Z' })
  updatedAt: string;

  @ApiProperty({ example: '0e9f7bc2-e062-4de3-8663-0286f28bbba6' })
  streamId: string;

  @ApiProperty({ type: () => UserDto })
  user: UserDto;

  @ApiProperty({ example: '44553e5a-906f-4e7e-b78b-d60d8c4aef99' })
  userId: string;

  @ApiProperty({ example: 'Hiii' })
  message: string;

  @ApiProperty({ example: '', required: false })
  imageURL?: string;
}

export class GetMessagesResponseDto {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Successfully Listed' })
  message: string;

  @ApiProperty({ type: [ChatMessageDto] })
  data: ChatMessageDto[];

  @ApiProperty({ example: 1 })
  total: number;
}

