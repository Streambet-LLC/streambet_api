import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { AdminFilterDto } from 'src/common/filters/filter.dto';
import { StreamStatus } from 'src/enums/stream.enum';

export class LiveScheduledStreamListDto extends AdminFilterDto {
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
}

export class StreamFilterDto extends LiveScheduledStreamListDto {
  @ApiPropertyOptional({
    enum: StreamStatus,
    default: StreamStatus.ACTIVE,
    description: `available streamStatus -> live and scheduled`,
    required: false,
  })
  @IsOptional()
  @IsEnum(StreamStatus)
  streamStatus?: string;
}
