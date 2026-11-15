import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

const normEmail = Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export class RegisterDto {
  @normEmail @IsEmail() @Length(3, 254) email!: string;
  @IsString() @Length(10, 128) password!: string;
  @IsString() @Length(1, 120) full_name!: string;
  @IsOptional() @IsInt() @Min(1900) @Max(2100) birth_year?: number;
  @IsOptional() @normEmail @IsEmail() guardian_email?: string;
}

export class LoginDto {
  @normEmail @IsEmail() email!: string;
  @IsString() @Length(1, 128) password!: string;
}

export class VerifyEmailDto {
  @IsString() @Length(20, 100) token!: string;
}

export class ResendDto {
  @normEmail @IsEmail() email!: string;
}

export class DeviceOtpDto {
  @IsString() @Length(20, 2000) challenge_token!: string;
}

export class RevokeDevicesDto {
  @IsString() @Length(20, 2000) challenge_token!: string;
  @IsString() @Matches(/^\d{6}$/) otp!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID('all', { each: true }) device_ids!: string[];
}
