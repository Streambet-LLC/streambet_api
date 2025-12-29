import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateNewReferralLinkDto {
  @ApiProperty({
    description: `code`,
    required: false,
  })
  @IsString()
  public code: string;
}
