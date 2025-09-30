import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class FilterDto {
  @ApiProperty({ description: 'Search by name', required: false })
  @IsString()
  @IsOptional()
  q: string;

  @ApiProperty({ description: 'Filter by created_at', required: false })
  @IsString()
  @IsOptional()
  @IsDateString()
  created_at_gte: Date;

  @ApiProperty({ description: 'Filter by created_at', required: false })
  @IsString()
  @IsOptional()
  @IsDateString()
  created_at_lte: Date;

  @ApiProperty({ description: 'Filter by status', required: false })
  @IsNumber()
  @IsOptional()
  status: number;

  @ApiProperty({ description: 'Filter By ids', required: false })
  @IsArray()
  @IsOptional()
  id: number[];

  @ApiProperty({ description: 'Display At', required: false })
  @IsString()
  @IsOptional()
  display_at: string;

  @ApiPropertyOptional({
    type: String,
    default: 'true',
    enum: ['true', 'false'],
    description:
      'Pass with parameter false if you want the results without pagination',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) =>
    value && value === 'false' ? false : true,
  )
  pagination?: boolean;
}
export class AdminFilterDto {
  @ApiProperty({
    required: false,
    default: '[0,24]',
    description: 'Number of records eg: [0,24]',
  })
  @IsString()
  @IsOptional()
  public range?: string;

  @ApiProperty({
    required: false,
    default: '["createdAt","DESC"]',
    description: 'Sort order for the list, eg: ["createdAt","DESC"]',
  })
  @IsString()
  @IsOptional()
  public sort?: string;
}
export type Range = [number, number];
export type Sort = [string, 'DESC' | 'ASC'];
export const transformFilterParam = (value: any): string | string[] =>
  value.length > 0
    ? value.map((item: string) => item.trim().toLowerCase())
    : value;
