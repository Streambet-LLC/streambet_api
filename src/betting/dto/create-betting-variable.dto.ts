import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsArray,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OptionDto {
  @IsString()
  @IsNotEmpty()
  option: string;
}

export class EditOptionDto {
  @IsUUID()
  @IsOptional()
  id?: string; // Optional for existing options

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

export class EditBettingVariableDto {
  @IsString()
  @IsNotEmpty()
  roundName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditOptionDto)
  options: EditOptionDto[];
}
