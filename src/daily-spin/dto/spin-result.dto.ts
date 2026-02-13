import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for successful daily spin execution
 */
export class SpinResultDto {
  @ApiProperty({
    description: 'The CadeCoin reward amount won from the spin',
    example: 5,
    minimum: 1,
  })
  reward: number;

  @ApiProperty({
    description: "User's updated CadeCoin balance after the spin",
    example: 105,
  })
  cadeCoinsBalance: number;

  @ApiProperty({
    description: "User's lifetime CadeCoins earned (including this spin)",
    example: 1250,
  })
  lifetimeCoinsEarned: number;

  @ApiProperty({
    description: 'Timestamp when the next spin will be available (midnight UTC)',
    example: '2026-02-10T00:00:00.000Z',
  })
  nextSpinAt: Date;

  @ApiProperty({
    description: 'ID of the transaction record created for this spin',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  transactionId: string;
}
