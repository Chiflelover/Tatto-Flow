import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const LEAD_FILTERS = ['all', 'verified', 'requires-review', 'completed'] as const;
export type LeadFilter = (typeof LEAD_FILTERS)[number];

export class LeadListQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(LEAD_FILTERS)
  filter: LeadFilter = 'all';
}

export class SaveManualPriceDto {
  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  minPrice!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  maxPrice!: number;
}

export class PricingRulePriceUpdateDto {
  @IsUUID('4')
  pricingRuleId!: string;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  minPrice!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  maxPrice!: number;
}

export class UpdatePricingRulesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @ValidateNested({ each: true })
  @Type(() => PricingRulePriceUpdateDto)
  updates!: PricingRulePriceUpdateDto[];
}
