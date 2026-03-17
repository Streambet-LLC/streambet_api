import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum ConversationTab {
  ALL = 'all',
  SUPPORT = 'support',
  BLOCKED = 'blocked',
}

export class ListConversationsDto {
  @ApiPropertyOptional({
    enum: ConversationTab,
    description: 'Filter by tab',
    default: ConversationTab.ALL,
  })
  @IsEnum(ConversationTab)
  @IsOptional()
  tab?: ConversationTab = ConversationTab.ALL;

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

export class ListMessagesDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 50 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 50;
}
