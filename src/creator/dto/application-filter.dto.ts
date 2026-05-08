import { IsOptional, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ApplicationFilterDto {
  @ApiProperty({
    required: false,
    enum: ['pending', 'approved', 'rejected'],
    description: 'Filter by application status',
  })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: string;

  @ApiProperty({
    required: false,
    enum: ['creator', 'seller'],
    description: 'Filter by application type',
  })
  @IsOptional()
  @IsIn(['creator', 'seller'])
  applicationType?: string;

  @ApiProperty({
    required: false,
    minimum: 1,
    default: 1,
    description: 'Page number',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 100,
    default: 25,
    description: 'Items per page',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}
