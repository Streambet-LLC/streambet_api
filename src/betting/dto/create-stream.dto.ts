import {
  IsNotEmpty,
  IsString,
  IsUrl,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class CreateStreamDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUrl()
  @IsNotEmpty()
  kickEmbedUrl: string;

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsDateString()
  @IsOptional()
  scheduledStartTime?: string;

  @IsDateString()
  @IsOptional()
  endTime?: string;
}
