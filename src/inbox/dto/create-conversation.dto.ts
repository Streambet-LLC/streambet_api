import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ConversationType } from '../entities/conversation.entity';

export class CreateConversationDto {
  @ApiProperty({
    description: 'The user ID of the recipient (seller for direct, omit for support)',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  recipientId?: string;

  @ApiProperty({
    enum: ConversationType,
    description: 'Type of conversation: direct (to a seller) or support',
  })
  @IsEnum(ConversationType)
  @IsNotEmpty()
  type: ConversationType;

  @ApiPropertyOptional({
    description: 'Subject line for the conversation',
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  subject?: string;

  @ApiProperty({ description: 'Initial message content' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  initialMessage: string;
}
