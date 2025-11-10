import { ApiProperty } from "@nestjs/swagger";
import { IsDefined, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class StreamIdDto {
  @ApiProperty({
    required: true,
    description: 'The ID of the stream',
  })
  @IsString()
  @IsDefined()
  @IsNotEmpty()
  streamId: string;
}

export class BetRoundDetailsDto {
  @ApiProperty({
    description: 'Id of the bet round',
    required: false,
  })
  @IsOptional()
  roundId?: string;

  @ApiProperty({
    description: 'Id of the user',
    required: false,
  })
  @IsOptional()
  @IsString()
  userId?: string;
}

