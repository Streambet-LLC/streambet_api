import { IsDefined, IsNotEmpty, IsNumber, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddFreeTokenDto {
  @ApiProperty({
    description: 'The UUID of the user to soft delete',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'The total amount added to the wallet',
  })
  @IsNumber()
  @IsDefined()
  @IsNotEmpty()
  amount: number;
}
