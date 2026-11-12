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
/** A code of the app or a recovery code, with what a person may type around it. */
const MAX_CODE_LENGTH = 32;
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

  @ApiPropertyOptional({
    maxLength: MAX_CODE_LENGTH,
    description:
      'The six digits of the authenticator app, for an account with a second factor (MFA_CODE_REQUIRED)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CODE_LENGTH)
  readonly code?: string;

  @ApiPropertyOptional({
    maxLength: MAX_CODE_LENGTH,
    description: 'One of the recovery codes instead of the code of the app; each counts once',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CODE_LENGTH)
  readonly recoveryCode?: string;
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

/** The link of a security e-mail (E10 to E12): "this was not me". */
export class SecureAccountDto {
  @ApiProperty({ maxLength: MAX_TOKEN_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TOKEN_LENGTH)
  readonly token!: string;
}

/** One sign-in of the own account (A04): a browser or the app, until it signs out or runs out. */
export class SignInDto {
  @ApiProperty({ format: 'uuid', description: 'The sign-in and every token refreshed from it' })
  readonly id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 60,
    description: 'Browser or app and system, for example "Chrome · Windows"; null when unknown',
  })
  readonly device!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly signedInAt!: string;

  @ApiProperty({ format: 'date-time', description: 'The last refresh: when it was last used' })
  readonly lastActiveAt!: string;

  @ApiProperty({ description: 'The sign-in of this request' })
  readonly current!: boolean;

  @ApiProperty({ description: 'Signed in with the code of an authenticator app too' })
  readonly secondFactor!: boolean;
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

  @ApiProperty({ description: 'Whether a sign-in needs the code of an authenticator app' })
  readonly mfaEnabled!: boolean;
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

/** The start of the second factor: the app takes the secret from the QR code or typed in. */
export class TotpSetupDto {
  @ApiProperty({ description: 'The secret in base32, to type into an authenticator app' })
  readonly secret!: string;

  @ApiProperty({ description: 'What the QR code shows: an otpauth URI with the secret' })
  readonly otpauthUri!: string;
}

export class ConfirmTotpDto {
  @ApiProperty({
    maxLength: MAX_CODE_LENGTH,
    description: 'A current code of the authenticator app, which proves that it has the secret',
  })
  @IsString()
  @MaxLength(MAX_CODE_LENGTH)
  readonly code!: string;
}

/** The session that now counts with both factors: in cookies for a browser, tokens for the app. */
export class TotpEnabledDto extends SessionDto {
  @ApiProperty({
    type: [String],
    description: 'Shown this once and stored only as hashes: each signs in once instead of a code',
  })
  readonly recoveryCodes!: string[];
}
