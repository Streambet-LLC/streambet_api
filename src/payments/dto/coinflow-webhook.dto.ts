import { 
    IsOptional, 
    IsString, 
    IsObject 
  } from 'class-validator';

  /** DTO for Coinflow webhook payload with flexible data shape. */
  export class CoinflowWebhookDto {
    @IsString()
    eventType: string;

    @IsString()
    category: string;

    @IsString()
    created: string;

    @IsObject()
    data: Record<string, unknown>;
  }
