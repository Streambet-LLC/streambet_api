import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { AdminFilterDto } from "src/common/filters/filter.dto";

export class PayoutReportFilterDto {
  @ApiProperty({
    description: `search filter`,
    required: false,
    default: '{}',
  })
  @IsString()
  @IsOptional()
  public search: string;

  @ApiProperty({
    required: false,
    default: '[0,24]',
    description: 'Number of records eg: [0,24]',
  })
  @IsString()
  @IsOptional()
  public range?: string;
}
