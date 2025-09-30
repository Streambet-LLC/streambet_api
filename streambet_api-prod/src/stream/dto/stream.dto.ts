import { ApiProperty } from "@nestjs/swagger";
import { IsDefined, IsNotEmpty, IsString } from "class-validator";

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

