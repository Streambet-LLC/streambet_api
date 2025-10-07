import { IsDefined, IsNotEmpty, IsNumber, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddGoldCoinDto {
  @ApiProperty({
    description: 'The UUID of the user to add gold coins to',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description:
      'The amount of gold coins to add (can be negative to subtract)',
    example: 1000,
    type: 'number',
  })
  @IsNumber()
  @IsDefined()
  @IsNotEmpty()
  amount: number;
}
