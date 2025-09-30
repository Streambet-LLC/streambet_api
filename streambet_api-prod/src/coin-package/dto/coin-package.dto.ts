import { ApiProperty } from '@nestjs/swagger';

export class CoinPackageDto {
  @ApiProperty({ example: 'a9cfe2e2-2557-4087-8971-0d753a2532d9' })
  id: string;

  @ApiProperty({ example: '2025-08-17T23:35:25.361Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-08-17T23:35:25.361Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'Starter Pack' })
  name: string;

  @ApiProperty({ example: '10.00', description: 'Total amount in USD as a string' })
  totalAmount: string;

  @ApiProperty({ example: null, nullable: true })
  description: string | null;

  @ApiProperty({ example: '1000.00', description: 'Sweep coin count as a string' })
  sweepCoinCount: string;

  @ApiProperty({ example: '1000', description: 'Gold coin count as a string' })
  goldCoinCount: string;

  @ApiProperty({ example: 'coin/2cf96dfd-ebb1-49d1-8414-c01372752772-coin.svg', nullable: true })
  imageUrl: string | null;

  @ApiProperty({ example: true })
  status: boolean;
}

export class CoinPackageListResponseDto {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Coin packages retrieved successfully' })
  message: string;

  @ApiProperty({ type: [CoinPackageDto] })
  data: CoinPackageDto[];
}


