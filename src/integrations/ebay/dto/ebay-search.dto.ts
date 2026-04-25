import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

export class EbayListingDto {
  title: string | null;
  price: number | null;
  currency: string | null;
  condition: string | null;
  grade: string | null;
  imageUrl: string | null;
  itemWebUrl: string | null;
  seller: string | null;
  buyingOptions: string[];
}

export class EbaySearchRequestDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class EbayImageSearchRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(6000000)
  imageBase64: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class EbaySearchResponseDto {
  listings: EbayListingDto[];
}
