import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { AdminFilterDto } from 'src/common/filters/filter.dto';
import { CurrencyType } from '../entities/transaction.entity';

export class TransactionFilterDto extends AdminFilterDto {
  @ApiProperty({
    description: `
  Filter params pass the data as key value pair
  eg:
  {
    "q": <stream_name>
   
  }
  `,
    required: false,
    default: '{}',
  })
  @IsString()
  public filter: string;

  @ApiPropertyOptional({
    type: String,
    default: true,
    description:
      'Pass with parameter false if you want the results without pagination',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) =>
    value && value === 'false' ? false : true,
  )
  pagination?: boolean;

  @ApiPropertyOptional({
    enum: CurrencyType,
    default: 'stream_coins',
    description: `available streamStatus -> free_tokens and stream_coins`,
  })
  @IsOptional()
  @IsEnum(CurrencyType)
  currencyType?: string;
}
