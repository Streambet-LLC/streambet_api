import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
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
      'Number of Stream Coins to withdraw. Must meet the minimum withdrawable threshold and be <= available balance.',
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

export class CoinflowWithdrawKycDto {
  @ApiProperty({
    description:
      'Redirect link to redirect user after additional verification',
    example: 'https://stag.streambet.tv/withdraw',
    required: true,
    type: String,
  })
  @IsString()
  redirectLink: string;

  @ApiProperty({
    description:
      'Email of the redeeming user.',
    example: 'johndoe@gmail.com',
    required: true,
    type: String,
  })
  @IsEmail()
  @IsString()
  email: string;

  @ApiProperty({
    description:
      'Country code of the redeeming user.',
    example: 'US',
    type: String,
  })
  @IsString()
  country: string;
}

export class CoinflowWithdrawKycUsDto {
  @ApiProperty({
    description:
      'Redirect link to redirect user after additional verification',
    example: 'https://stag.streambet.tv/withdraw',
    required: true,
    type: String,
  })
  @IsString()
  redirectLink: string;
  
  @ApiProperty({
    description:
      'Email of the redeeming user.',
    example: 'johndoe@gmail.com',
    required: true,
    type: String,
  })
  @IsEmail()
  @IsString()
  email: string;

  @ApiProperty({
    description:
      'Country code of the redeeming user.',
    example: 'US',
    type: String,
  })
  @IsString()
  country: string;

  @ApiProperty({
    description:
      'First name of the redeeming user.',
    example: 'John',
    type: String,
  })
  @IsString()
  firstName: string;

  @ApiProperty({
    description:
      'Last name of the redeeming user.',
    example: 'Doe',
    type: String,
  })
  @IsString()
  lastName: string;

  @ApiProperty({
    description:
      'Address of the redeeming user.',
    example: '15 Applesweet St. Rocky Road',
    type: String,
  })
  @IsString()
  address: string;

  @ApiProperty({
    description:
      'City of the redeeming user.',
    example: 'New York',
    type: String,
  })
  @IsString()
  city: string;

  @ApiProperty({
    description:
      'State of the redeeming user.',
    example: 'CA',
    type: String,
  })
  @IsString()
  state: string;

  @ApiProperty({
    description:
      'Zip of the redeeming user.',
    example: '7000',
    type: String,
  })
  @IsString()
  zip: string;

  @ApiProperty({
    description:
      'Date of birth (YYYYMMDD) of the redeeming user.',
    example: '19701012',
    type: String,
  })
  @IsString()
  dob: string;

  @ApiProperty({
    description:
      'Last 4 digits of SSN of the redeeming user.',
    example: '1234',
    type: String,
  })
  @IsString()
  @MinLength(4)
  @MaxLength(4)
  ssn: string;
}


