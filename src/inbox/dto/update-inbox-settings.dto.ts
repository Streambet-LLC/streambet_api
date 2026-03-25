import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateInboxSettingsDto {
  @ApiProperty({ description: 'Enable or disable read receipts' })
  @IsBoolean()
  readReceiptsEnabled: boolean;
}
