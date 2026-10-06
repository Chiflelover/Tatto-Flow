import { Transform, Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import { LeadStatus } from '../../../generated/prisma/client.js';

export const LEAD_FILTERS = ['all', 'verified', 'requires-review', 'completed'] as const;
export type LeadFilter = (typeof LEAD_FILTERS)[number];
export const LEAD_SORT_FIELDS = ['price', 'createdAt', 'targetSizeCm', 'status'] as const;
export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];
export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export class SaveManualFinalPriceDto {
  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  price!: number;
}

export class LeadListQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(LEAD_FILTERS)
  filter: LeadFilter = 'all';

  @IsOptional()
  @IsIn(Object.values(LeadStatus))
  status?: LeadStatus;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsIn([true, false])
  archived = false;

  @IsOptional()
  @IsIn(LEAD_SORT_FIELDS)
  sortBy?: LeadSortField;

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder: SortOrder = 'desc';

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(20)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  pageSize = 20;
}
