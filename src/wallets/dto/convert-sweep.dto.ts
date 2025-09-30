import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

/**
 * Query DTO for converting sweep coins to USD.
 * Uses transform to parse numeric query param and validates non-negative values.
 */
export class ConvertSweepQueryDto {
  @ApiProperty({
    description: 'Sweep coin amount to convert to USD',
    example: 40,
  })
  @Transform(({ value }: TransformFnParams) => (value !== undefined ? parseFloat(value as any) : undefined))
  @IsNumber()
  @Min(0)
  coins: number;
}


