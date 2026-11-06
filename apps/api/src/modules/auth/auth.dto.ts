import { LOCALES, PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './domain/password-policy.js';

const MAX_EMAIL_LENGTH = 254;
const MAX_TOKEN_LENGTH = 256;
/**
 * ASCII for a new account. The column compares through `lower()`, which turns the Kelvin sign and
 * the dotted capital I into plain letters: a look-alike could take the address of its owner.
 */
const NEW_ACCOUNT_EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/;

export class RegisterDto {
  @ApiProperty({
    format: 'email',
    maxLength: MAX_EMAIL_LENGTH,
    pattern: NEW_ACCOUNT_EMAIL.source,
  })
  @IsEmail()
  @Matches(NEW_ACCOUNT_EMAIL)
  @MaxLength(MAX_EMAIL_LENGTH)
  readonly email!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(MAX_PASSWORD_LENGTH)
  readonly password!: string;

  @ApiProperty({ enum: LOCALES, description: 'The language of e-mails to this person' })
  @IsIn(LOCALES)
  readonly locale!: string;

  @ApiProperty({
    enum: [PRIVACY_NOTICE_VERSION],
    description: 'The version of the privacy notice the person agreed to: the current one',
  })
  @IsIn([PRIVACY_NOTICE_VERSION])
  readonly privacyNoticeVersion!: string;
}

/** Only a length: whether a password follows today's rules says nothing about an old account. */
export class LoginDto {
  @ApiProperty({ format: 'email', maxLength: MAX_EMAIL_LENGTH })
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  readonly email!: string;

  @ApiProperty({ maxLength: MAX_PASSWORD_LENGTH })
  @IsString()
  @MaxLength(MAX_PASSWORD_LENGTH)
  readonly password!: string;

  @ApiPropertyOptional({
    enum: ['cookie', 'body'],
    default: 'cookie',
    description: 'A browser gets cookies; the app asks for the tokens in the answer',
  })
  @IsOptional()
  @IsIn(['cookie', 'body'])
  readonly delivery?: 'cookie' | 'body';
}

/** The app sends its refresh token here; a browser's comes as a cookie. */
export class RefreshDto {
  @ApiPropertyOptional({ maxLength: MAX_TOKEN_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TOKEN_LENGTH)
  readonly refreshToken?: string;
}

/** The password shows that whoever holds the mailbox is who signed up. */
export class ConfirmEmailDto {
  @ApiProperty({ maxLength: MAX_TOKEN_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TOKEN_LENGTH)
  readonly token!: string;

  @ApiProperty({ maxLength: MAX_PASSWORD_LENGTH })
  @IsString()
  @MaxLength(MAX_PASSWORD_LENGTH)
  readonly password!: string;
}

export class EmailDto {
  @ApiProperty({ format: 'email', maxLength: MAX_EMAIL_LENGTH })
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  readonly email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ maxLength: MAX_TOKEN_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TOKEN_LENGTH)
  readonly token!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(MAX_PASSWORD_LENGTH)
  readonly password!: string;
}

export class UpdateAccountDto {
  @ApiProperty({ enum: LOCALES })
  @IsIn(LOCALES)
  readonly locale!: string;
}

export class AccountDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'email' })
  readonly email!: string;

  @ApiProperty({ description: 'Needed before the first booking (BR-09)' })
  readonly emailVerified!: boolean;

  @ApiProperty({ enum: LOCALES })
  readonly locale!: string;
}

export class TokensDto {
  @ApiProperty()
  readonly accessToken!: string;

  @ApiProperty()
  readonly refreshToken!: string;

  @ApiProperty({ description: 'How long the access token lasts' })
  readonly expiresInSeconds!: number;
}

export class SessionDto {
  @ApiProperty({ type: AccountDto })
  readonly account!: AccountDto;

  @ApiPropertyOptional({ type: TokensDto, description: 'Only when asked for in the answer' })
  readonly tokens?: TokensDto;
}
