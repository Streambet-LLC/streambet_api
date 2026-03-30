import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNumber, Max, Min } from 'class-validator';

export class UpdateUserFeeOverrideDto {
  @ApiProperty({
    description: 'Permanent seller fee override percent',
    example: 3.5,
    minimum: 2,
    maximum: 4,
  })
  @IsDefined()
  @IsNumber()
  @Min(2)
  @Max(4)
  feePercent: number;
}
