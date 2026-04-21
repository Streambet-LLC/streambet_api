import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export type ReviewListRoleFilter = 'as_buyer' | 'as_seller' | 'all';
export type ReviewListSort = 'newest' | 'oldest' | 'highest' | 'lowest';

export class ListReviewsQueryDto {
  @ApiPropertyOptional({
    enum: ['as_buyer', 'as_seller', 'all'],
    description:
      'as_buyer: reviews of this user when they were the buyer. as_seller: reviews of this user when they were the seller. all: combined.',
    default: 'all',
  })
  @IsOptional()
  @IsEnum(['as_buyer', 'as_seller', 'all'])
  role?: ReviewListRoleFilter;

  @ApiPropertyOptional({
    enum: ['newest', 'oldest', 'highest', 'lowest'],
    default: 'newest',
  })
  @IsOptional()
  @IsEnum(['newest', 'oldest', 'highest', 'lowest'])
  sort?: ReviewListSort;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  perPage?: number;
}
