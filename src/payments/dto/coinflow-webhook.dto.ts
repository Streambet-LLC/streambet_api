import { 
    IsOptional, 
    IsString, 
    IsNumber, 
    IsObject, 
    ValidateNested 
  } from 'class-validator';
  import { Type } from 'class-transformer';
  
  class AmountDto {
    @IsNumber()
    cents: number;
  
    @IsString()
    currency: string;
  }
  
  class WebhookInfoDto {
    [key: string]: string;
  }
  
  class DataDto {
    @IsString()
    id: string;
  
    @IsOptional()
    @IsString()
    signature?: string;
  
    @IsOptional()
    @IsString()
    wallet?: string;
  
    @IsOptional()
    // Accept string or object from providers
    webhookInfo?: Record<string, string> | string | null;
  
    @ValidateNested()
    @Type(() => AmountDto)
    subtotal: AmountDto;
  
    @ValidateNested()
    @Type(() => AmountDto)
    fees: AmountDto;
  
    @ValidateNested()
    @Type(() => AmountDto)
    gasFees: AmountDto;
  
    @ValidateNested()
    @Type(() => AmountDto)
    chargebackProtectionFees: AmountDto;
  
    @ValidateNested()
    @Type(() => AmountDto)
    total: AmountDto;
  
    @IsOptional()
    @IsString()
    merchantId?: string;
  
    @IsOptional()
    @IsString()
    customerId?: string;
  
    @IsOptional()
    @IsString()
    rawCustomerId?: string;

    @IsOptional()
    @IsString()
    paymentMethod?:string
  }
  
  /** DTO for Coinflow webhook payload. */
  export class CoinflowWebhookDto {
    @IsString()
    eventType: string;
  
    @IsString()
    category: string;
  
    @IsString()
    created: string;
  
    @ValidateNested()
    @Type(() => DataDto)
    data: DataDto;
  }
  