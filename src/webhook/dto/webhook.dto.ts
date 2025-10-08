import { 
    IsString, 
  } from 'class-validator';

  /** DTO for webhook payload. */
  export class WebhookDto {
    @IsString()
    webhookId: string;

    @IsString()
    data: string;
  }
