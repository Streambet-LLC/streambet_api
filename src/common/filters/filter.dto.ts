import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

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
