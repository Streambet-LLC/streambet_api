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

export class RoundDto {
  @IsString()
  @IsNotEmpty()
  roundName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionDto)
  options: OptionDto[];
}

export class EditRoundDto {
  @IsUUID()
  @IsOptional()
  roundId?: string; // Optional for existing rounds

  @IsString()
  @IsNotEmpty()
  roundName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditOptionDto)
  options: EditOptionDto[];
}

export class CreateBettingVariableDto {
  @IsUUID()
  @IsNotEmpty()
  streamId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoundDto)
  rounds: RoundDto[];
}

export class EditBettingVariableDto {
  @IsUUID()
  @IsNotEmpty()
  streamId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditRoundDto)
  rounds: EditRoundDto[];
}
