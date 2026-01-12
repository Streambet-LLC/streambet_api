import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for user's shipping address
 * Only returned to authenticated users for their own address
 */
export class UserAddressDto {
  @ApiProperty({ 
    example: '123 Main Street, Apt 4B', 
    description: 'Street address',
    nullable: true
  })
  address: string | null;

  @ApiProperty({ 
    example: 'Apt 4B', 
    description: 'Apartment, suite, unit, etc.',
    nullable: true,
    required: false
  })
  address2: string | null;

  @ApiProperty({ 
    example: 'New York', 
    description: 'City',
    nullable: true
  })
  city: string | null;

  @ApiProperty({ 
    example: 'NY', 
    description: 'State or province',
    nullable: true
  })
  state: string | null;

  @ApiProperty({ 
    example: '10001', 
    description: 'ZIP or postal code',
    nullable: true
  })
  zipCode: string | null;

  @ApiProperty({ 
    example: 'United States', 
    description: 'Country',
    nullable: true
  })
  country: string | null;
}
