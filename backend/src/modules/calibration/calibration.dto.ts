import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CalibrationCaseType } from '../../generated/prisma/client.js';

export class CreateStyleDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;
}

export class UpdateStyleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCaseDto {
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  imageUrl!: string;

  @IsIn(Object.values(CalibrationCaseType))
  type!: CalibrationCaseType;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  areaCm2!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1)
  colorCoverage!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder!: number;
}

export class UpdateCaseDto {
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  imageUrl?: string;

  @IsOptional()
  @IsIn(Object.values(CalibrationCaseType))
  type?: CalibrationCaseType;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  areaCm2?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1)
  colorCoverage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class EnableStyleDto {
  @IsBoolean()
  enabled!: boolean;
}

export class CalibrationAnswerDto {
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  price!: number;
}

export class AdjustmentDto {
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(-99.99)
  @Max(1000)
  percent!: number;
}
