import { ApiProperty } from '@nestjs/swagger';

export class UserProfileResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  role: string;
  @ApiProperty()
  profileImageUrl: string;
  @ApiProperty()
  lastKnownIP: string;
}
