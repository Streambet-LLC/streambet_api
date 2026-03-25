import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsInt, Min, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ConversationType } from '../entities/conversation.entity';

export enum AdminConversationTab {
  SUPPORT = 'support',
  USER_MESSAGES = 'user_messages',
}

export class AdminListConversationsDto {
  @ApiPropertyOptional({
    enum: AdminConversationTab,
    description: 'Filter by tab',
    default: AdminConversationTab.SUPPORT,
  })
  @IsEnum(AdminConversationTab)
  @IsOptional()
  tab?: AdminConversationTab = AdminConversationTab.SUPPORT;

  @ApiPropertyOptional({ description: 'Search by username or subject' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}

export class AdminSendMessageDto {
  @ApiPropertyOptional({ description: 'Message content' })
  @IsString()
  content: string;
}
