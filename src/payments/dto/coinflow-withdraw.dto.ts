import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Min,
} from 'class-validator';
import { CoinflowPayoutSpeed } from 'src/enums/coinflow-payout-speed.enum';

/**
 * DTO for initiating a Coinflow delegated payout (withdrawal) for the authenticated user.
 *
 * - coins: Number of sweep coins to withdraw (converted to USD on the server).
 * - waitForConfirmation: If true (default), waits for on-chain confirmation before responding.
 */

export class CoinflowWithdrawDto {
  @ApiProperty({
    description:
      'Number of sweep coins to withdraw. Must meet the minimum withdrawable threshold and be <= available balance.',
    example: 200,
    type: Number,
  })
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : value))
  @IsInt()
  @Min(1)
  coins: number;

  @ApiProperty({
    description:
      'Coinflow withdrawer account token to receive funds (bank/card/iban token from frontend).',
    example: 'cab00300-2b5e-42ec-93c8-3bf57a3b3eb6',
  })
  @IsString()
  account: string;

  @ApiProperty({
    description: 'Payout speed. Must be a supported Coinflow enum value.',
    enum: CoinflowPayoutSpeed,
    example: CoinflowPayoutSpeed.SAME_DAY,
  })
  @IsEnum(CoinflowPayoutSpeed)
  speed: CoinflowPayoutSpeed;
}


