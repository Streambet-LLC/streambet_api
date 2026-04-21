import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class PsaImportRequestDto {
  @ApiProperty({
    example: '27544965',
    description: 'PSA certification number printed on the slab label',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'certNumber must contain only letters, numbers, and hyphens',
  })
  certNumber: string;
}

export class PsaImportResponseDto {
  @ApiProperty({ example: '27544965' })
  certNumber: string;

  @ApiProperty({ example: 'PSA 10 2003 Pokemon Base Set Charizard #4' })
  title: string;

  @ApiProperty({ example: 'pokemon', nullable: true })
  brand: string | null;

  @ApiProperty({ example: 'slab', nullable: true })
  category: string | null;

  @ApiProperty({ example: '2003', nullable: true })
  year: string | null;

  @ApiProperty({ example: '4', nullable: true })
  cardNumber: string | null;

  @ApiProperty({ example: 'Charizard', nullable: true })
  subject: string | null;

  @ApiProperty({ example: 'Base Set', nullable: true })
  variety: string | null;

  @ApiProperty({ example: 'Gem Mint 10', nullable: true })
  gradeDescription: string | null;

  @ApiProperty({ example: '10', nullable: true })
  cardGrade: string | null;

  @ApiProperty({
    example: 'PSA 10 2003 Pokemon Base Set Charizard #4',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    example: ['https://images.psacard.com/card-front.jpg', 'https://images.psacard.com/card-back.jpg'],
    type: [String],
  })
  imageUrls: string[];

  @ApiProperty({ example: 0 })
  coverImageIndex: number;

  @ApiProperty({ example: 'https://images.psacard.com/card-front.jpg', nullable: true })
  coverImageUrl: string | null;

  @ApiProperty({ example: true })
  hasImages: boolean;

  @ApiProperty({ example: 123456, nullable: true })
  psaSpecId: number | null;

  @ApiProperty({
    nullable: true,
    example: {
      gradePopulation: 1001,
    },
  })
  psaPopulation: {
    gradePopulation: number | null;
  } | null;

  @ApiProperty({ example: false })
  rateLimitedUntilTomorrow: boolean;

  @ApiProperty({
    nullable: true,
    example: '2026-04-04T00:00:00.000Z',
  })
  rateLimitedUntil: string | null;

  @ApiProperty({
    example: 'https://www.psacard.com/cert/149927601/psa',
  })
  psaCertUrl: string;

  @ApiProperty({
    nullable: true,
    example: {
      certNumber: '149927601',
      itemGrade: 'GEM MT 10',
      labelType: 'PSA Fugitive Ink Technology',
      fugitiveInkTechnology: 'W/ FUGITIVE INK TECHNOLOGY',
      reverseCertBarcode: 'YES',
      year: '2023',
      brandTitle: 'ONE PIECE OP04-KINGDOMS OF INTRIGUE',
      subject: 'TRAFALGAR LAW',
      cardNumber: '047',
      category: 'TCG CARDS',
      varietyPedigree: 'SPECIAL ALTERNATE ART',
    },
  })
  itemInformation: {
    certNumber: string;
    itemGrade: string | null;
    labelType: string | null;
    fugitiveInkTechnology: string | null;
    reverseCertBarcode: string | null;
    year: string | null;
    brandTitle: string | null;
    subject: string | null;
    cardNumber: string | null;
    category: string | null;
    varietyPedigree: string | null;
  };

  @ApiProperty({ example: 'psa' })
  source: 'psa';
}