import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../auth/password-policy.js';

export class CreateArtistAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @IsString()
  @Matches(/^\+?[0-9\s()-]{8,30}$/)
  phoneNumber!: string;

  @IsString()
  @Matches(/^[0-9]{1,64}$/)
  phoneNumberId!: string;

  @IsBoolean()
  isActive!: boolean;
}

export class UpdateArtistAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s()-]{8,30}$/)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{1,64}$/)
  phoneNumberId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
