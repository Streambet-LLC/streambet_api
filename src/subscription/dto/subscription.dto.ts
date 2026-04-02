import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionPlan } from '../../enums/subscription-plan.enum';

export class CreateSubscriptionDto {
  @ApiProperty({ enum: SubscriptionPlan, example: SubscriptionPlan.MONTHLY })
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;
}

export class UpgradeSubscriptionDto {
  @ApiProperty({
    enum: [SubscriptionPlan.YEARLY],
    example: SubscriptionPlan.YEARLY,
  })
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;
}

export class AdminGrantProDto {
  @ApiProperty({ description: 'User ID to grant pro to' })
  userId: string;

  @ApiProperty({ enum: SubscriptionPlan, example: SubscriptionPlan.MONTHLY })
  @IsEnum(SubscriptionPlan)
  @IsOptional()
  plan?: SubscriptionPlan;
}
