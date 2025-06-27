import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OptionDto {
  @IsString()
  @IsNotEmpty()
  option: string;
}

export class CreateBettingVariableDto {
  @IsUUID()
  @IsNotEmpty()
  streamId: string;

  @IsString()
  @IsNotEmpty()
  roundName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionDto)
  options: OptionDto[];
}
