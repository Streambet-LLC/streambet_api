import { ApiProperty } from "@nestjs/swagger";

export class CreatorApplicationDto {
  @ApiProperty({ type: String, description: 'First Name' })
  firstName: string;
  
  @ApiProperty({ type: String, description: 'Last Name' })
  lastName: string;

  @ApiProperty({ type: String, description: 'Email' })
  email: string;

  @ApiProperty({ type: String, description: 'Socials' })
  socials: string;

  @ApiProperty({ type: String, description: 'Application Pitch/Message' })
  message: string;
}