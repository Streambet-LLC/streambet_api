import { ApiProperty } from '@nestjs/swagger';

/**
 * Returned to the frontend so it can mount a Stripe Elements
 * SetupIntent flow and attach a card to the user's customer.
 * The `customerId` is included for the Payment Element's `customer`
 * option but is NOT a secret.
 */
export class CreateSetupIntentResponseDto {
  @ApiProperty({ example: 'seti_...secret...' })
  clientSecret: string;

  @ApiProperty({ example: 'cus_...' })
  customerId: string;
}
