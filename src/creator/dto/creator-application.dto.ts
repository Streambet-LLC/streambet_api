import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class CreatorApplicationDto {
  @ApiProperty({ type: String, description: 'First Name' })
  @IsString()
  firstName: string;
  
  @ApiProperty({ type: String, description: 'Last Name' })
  @IsString()
  lastName: string;

  @ApiProperty({ type: String, description: 'Email' })
  @IsString()
  email: string;

  @ApiProperty({ type: String, description: 'Socials' })
  @IsString()
  socials: string;

  @ApiProperty({ type: String, description: 'Application Pitch/Message' })
  @IsString()
  message: string;
}