import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class CoinPackageDto {
  @Expose()
  @ApiProperty({ example: 'a9cfe2e2-2557-4087-8971-0d753a2532d9' })
  id: string;

  @Expose()
  @ApiProperty({ example: '2025-08-17T23:35:25.361Z' })
  createdAt: Date;

  @Expose()
  @ApiProperty({ example: '2025-08-17T23:35:25.361Z' })
  updatedAt: Date;

  @Expose()
  @ApiProperty({ example: 'Starter Pack' })
  name: string;

  @Expose()
  @ApiProperty({ example: '10.00', description: 'Total amount in USD as a string' })
  totalAmount: string;

  @Expose()
  @ApiProperty({ example: null, nullable: true })
  description: string | null;

  @Expose()
  @ApiProperty({ example: '1000.00', description: 'Stream Coin count as a string' })
  sweepCoinCount: string;

  @Expose()
  @ApiProperty({ example: '1000', description: 'Gold coin count as a string' })
  goldCoinCount: string;

  @Expose()
  @ApiProperty({ example: 'coin/2cf96dfd-ebb1-49d1-8414-c01372752772-coin.svg', nullable: true })
  imageUrl: string | null;

  @Expose()
  @ApiProperty({ example: true })
  status: boolean;

  @Expose()
  @ApiProperty({ example: true, description: 'Whether the authenticated user can purchase this package within their remaining lifetime limit' })
  canPurchase: boolean;
}

export class CoinPackageListResponseDto {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Coin packages retrieved successfully' })
  message: string;

  @ApiProperty({ type: [CoinPackageDto] })
  data: CoinPackageDto[];

  @ApiProperty({ example: 100, description: 'Total USD amount the user has spent on Coinflow purchases' })
  spentUSD: number;

  @ApiProperty({ example: 400, description: 'USD amount the user can still spend before hitting the lifetime cap' })
  remainingUSD: number;

  @ApiProperty({ example: 500, description: 'Lifetime purchase cap in USD' })
  capUSD: number;
}


