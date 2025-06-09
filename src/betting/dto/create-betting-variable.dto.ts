import { IsNotEmpty, IsString, IsUUID, IsOptional } from 'class-validator';

export class CreateBettingVariableDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsNotEmpty()
  streamId: string;
}
