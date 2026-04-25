import { ApiProperty } from '@nestjs/swagger';

/**
 * Time remaining until next spin
 */
export class TimeRemaining {
  @ApiProperty({
    description: 'Hours until next spin',
    example: 15,
    minimum: 0,
  })
  hours: number;

  @ApiProperty({
    description: 'Minutes until next spin',
    example: 42,
    minimum: 0,
  })
  minutes: number;

  @ApiProperty({
    description: 'Seconds until next spin',
    example: 33,
    minimum: 0,
  })
  seconds: number;
}

/**
 * Response DTO for checking daily spin status
 */
export class SpinStatusDto {
  @ApiProperty({
    description: 'Whether the user can spin right now',
    example: true,
  })
  canSpin: boolean;

  @ApiProperty({
    description:
      'Timestamp when the next spin will be available (midnight UTC)',
    example: '2026-02-10T00:00:00.000Z',
  })
  nextSpinAt: Date;

  @ApiProperty({
    description: 'Time remaining until next spin (hours, minutes, seconds)',
    type: TimeRemaining,
  })
  timeUntilNextSpin: TimeRemaining;

  @ApiProperty({
    description: 'Timestamp of the last spin (if any)',
    example: '2026-02-09T14:23:11.000Z',
    required: false,
  })
  lastSpinAt?: Date;
}
