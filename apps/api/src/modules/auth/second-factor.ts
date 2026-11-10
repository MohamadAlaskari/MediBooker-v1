import { InjectTransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PlatformTransactionHost } from '../../common/database/platform-transactional.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { AMR_ONE_TIME_CODE } from '../../common/security/actor.js';
import { AuthSecrets } from '../../common/security/auth-secrets.js';
import { FieldCipher } from '../../common/security/field-cipher.js';
import { Clock } from '../../common/time/clock.js';
import { dbInstantOf, instantOf } from '../../common/time/convert.js';
import { InstallationPractice } from '../notifications/installation-practice.js';
import { lockedUntilAfter } from './domain/auth.rules.js';
import { newRecoveryCodes, normalizedRecoveryCode } from './domain/recovery-codes.js';
import { matchingStep, newTotpSecret, otpauthUri } from './domain/totp.js';

/** How a person signed in (RFC 8176): a password, and a one-time code as the second factor. */
export const AMR_PASSWORD = 'pwd';
export { AMR_ONE_TIME_CODE };
const WITH_PASSWORD: readonly string[] = [AMR_PASSWORD];
const WITH_CODE: readonly string[] = [AMR_PASSWORD, AMR_ONE_TIME_CODE];
/** Where the authenticator app lists the code, when the installation names no practice. */
const DEFAULT_ISSUER = 'MediBooker';

/** What a person sends besides the password, when the account has a second factor. */
export type SecondFactorInput = { readonly code: string } | { readonly recoveryCode: string };

/** The second factor of a sign-in, read and opened before any lock: a key must not hold a row. */
export interface PreparedFactor {
  readonly input: SecondFactorInput | undefined;
  /** The secret as stored, to see under the lock that it is still the one opened. */
  readonly sealed: string | null;
  readonly secret: string | undefined;
  /** The keyed hash of a recovery code that has the form of one. */
  readonly recoveryHash: string | undefined;
}

export type SignInVerdict =
  | { readonly amr: readonly string[]; readonly usedRecoveryCode: boolean }
  | { readonly failed: 'INVALID_CREDENTIALS' | 'MFA_CODE_REQUIRED' | 'MFA_CODE_INVALID' };

export interface TotpSetup {
  readonly secret: string;
  readonly otpauthUri: string;
}

/** The row of a sign-in, under the lock of the account. */
interface LockedAccount {
  readonly password_hash: string;
  readonly totp_secret_encrypted: string | null;
  readonly totp_enabled_at: Date | null;
  readonly totp_last_step: bigint | null;
  readonly mfa_failed_count: number;
  readonly mfa_locked_until: Date | null;
}

/** The secret is bound to its account: copied to another row, it does not open. */
function secretContextOf(userId: string): string {
  return `users.totp_secret_encrypted:${userId}`;
}

/**
 * The second factor of an account (ADR 0004 §7): a TOTP secret, encrypted with the field keys, and
 * ten recovery codes, stored as keyed hashes. A code counts once, also a recovery code. What changes
 * the factor or checks it runs under the lock of the account's row, which sign-in, refresh and a new
 * password take too. Mandatory for staff: their routes ask for it (`MFA_REQUIRED`).
 *
 * Wrong codes count on their own, with the wait of wrong passwords: a new password clears the failed
 * sign-ins, and whoever reads the mailbox must not get a new budget for guessing codes with it.
 */
@Injectable()
export class SecondFactor {
  constructor(
    @InjectTransactionHost('platform') private readonly txHost: PlatformTransactionHost,
    private readonly cipher: FieldCipher,
    private readonly secrets: AuthSecrets,
    private readonly installation: InstallationPractice,
    private readonly clock: Clock,
  ) {}

  /**
   * Before the transaction of a sign-in whose password matched. The row may be gone by now: a reset
   * of an account never confirmed makes it anew, and `verify` then answers like a wrong password.
   */
  async prepare(userId: string, input: SecondFactorInput | undefined): Promise<PreparedFactor> {
    const row = await this.txHost.tx.user.findUnique({
      where: { id: userId },
      select: { totpSecretEncrypted: true },
    });
    const sealed = row?.totpSecretEncrypted ?? null;
    const secret =
      input !== undefined && 'code' in input && sealed !== null
        ? await this.cipher.decrypt(sealed, secretContextOf(userId))
        : undefined;
    const recovery =
      input !== undefined && 'recoveryCode' in input
        ? normalizedRecoveryCode(input.recoveryCode)
        : undefined;
    const recoveryHash =
      recovery === undefined ? undefined : await this.recoveryHashOf(userId, recovery);
    return { input, sealed, secret, recoveryHash };
  }

  /**
   * In the sign-in's transaction: the account's row locked, its password still the one checked, and
   * with a second factor its code. A code moves the last accepted step on; a recovery code is spent.
   * A wrong one is counted here, and the transaction commits that: its answer is no exception.
   */
  async verify(
    userId: string,
    passwordHash: string,
    prepared: PreparedFactor,
  ): Promise<SignInVerdict> {
    const [row] = await this.txHost.tx.$queryRaw<LockedAccount[]>`
      SELECT password_hash, totp_secret_encrypted, totp_enabled_at, totp_last_step,
             mfa_failed_count, mfa_locked_until
      FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (row?.password_hash !== passwordHash) return { failed: 'INVALID_CREDENTIALS' };
    if (row.totp_enabled_at === null) return { amr: WITH_PASSWORD, usedRecoveryCode: false };
    const { input } = prepared;
    if (input === undefined) return { failed: 'MFA_CODE_REQUIRED' };
    const now = this.clock.now();
    // While the codes wait, none is looked at, and the answer is that of a wrong one.
    const waitsUntil = row.mfa_locked_until === null ? null : instantOf(row.mfa_locked_until);
    if (waitsUntil !== null && Temporal.Instant.compare(waitsUntil, now) > 0) {
      return { failed: 'MFA_CODE_INVALID' };
    }
    const step = 'code' in input ? this.stepOf(input.code, prepared, row) : undefined;
    const spent =
      'recoveryCode' in input && (await this.spendRecoveryCode(userId, prepared.recoveryHash));
    if (step === undefined && !spent) {
      const failures = row.mfa_failed_count + 1;
      const until = lockedUntilAfter(failures, now);
      await this.txHost.tx.user.update({
        where: { id: userId },
        data: {
          mfaFailedCount: failures,
          ...(until === undefined ? {} : { mfaLockedUntil: dbInstantOf(until) }),
        },
      });
      return { failed: 'MFA_CODE_INVALID' };
    }
    await this.txHost.tx.user.update({
      where: { id: userId },
      data: {
        mfaFailedCount: 0,
        mfaLockedUntil: null,
        ...(step === undefined ? {} : { totpLastStep: step }),
      },
    });
    return { amr: WITH_CODE, usedRecoveryCode: spent };
  }

  /** The step of a code of the app, if it is the secret that was opened before the lock. */
  private stepOf(code: string, prepared: PreparedFactor, row: LockedAccount): bigint | undefined {
    const { secret } = prepared;
    if (secret === undefined || prepared.sealed !== row.totp_secret_encrypted) return undefined;
    return matchingStep(secret, code, this.clock.now(), row.totp_last_step);
  }

  /**
   * Starts setting up the app: a new secret, not in force before a code confirms it. Starting again
   * replaces a secret that was never confirmed; one in force stays (`MFA_ALREADY_ENABLED`). Only for
   * the team for now (FORBIDDEN otherwise): only an operator gives a lost factor back, and a patient
   * would have no way back to the own appointments.
   */
  async start(userId: string): Promise<TotpSetup> {
    const secret = newTotpSecret();
    const sealed = await this.cipher.encrypt(secret, secretContextOf(userId));
    const account = await this.txHost.withTransaction(async () => {
      await this.lock(userId);
      const user = await this.txHost.tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, locale: true, totpEnabledAt: true },
      });
      if (user.totpEnabledAt !== null) throw new DomainException('MFA_ALREADY_ENABLED');
      const staff = await this.txHost.tx.practiceAccess.count({
        where: { userId, capacity: 'STAFF', active: true },
      });
      if (staff === 0) throw new DomainException('FORBIDDEN');
      await this.txHost.tx.user.update({
        where: { id: userId },
        data: { totpSecretEncrypted: sealed, totpLastStep: null },
      });
      return user;
    });
    const issuer = (await this.installation.nameIn(account.locale)) ?? DEFAULT_ISSUER;
    return { secret, otpauthUri: otpauthUri({ secret, account: account.email, issuer }) };
  }

  /**
   * In the caller's transaction: puts the secret in force with a first code and makes a new set of
   * recovery codes, which only this answer shows. Undefined: the code does not match.
   */
  async enable(userId: string, code: string, secret: string): Promise<string[] | undefined> {
    const now = this.clock.now();
    const step = matchingStep(secret, code, now, null);
    if (step === undefined) return undefined;
    const codes = newRecoveryCodes();
    const hashes = await Promise.all(
      codes.map((shown) => this.recoveryHashOf(userId, normalizedRecoveryCode(shown) ?? shown)),
    );
    const db = this.txHost.tx;
    await db.user.update({
      where: { id: userId },
      data: { totpEnabledAt: dbInstantOf(now), totpLastStep: step },
    });
    await db.mfaRecoveryCode.deleteMany({ where: { userId } });
    await db.mfaRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) });
    return codes;
  }

  /**
   * Before the transaction that confirms: the secret waiting for its first code. Undefined: none
   * waits, because setting up never started or is done.
   */
  async pendingSecretOf(
    userId: string,
  ): Promise<{ readonly sealed: string; readonly secret: string } | undefined> {
    const user = await this.txHost.tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpSecretEncrypted: true, totpEnabledAt: true },
    });
    if (user.totpEnabledAt !== null) throw new DomainException('MFA_ALREADY_ENABLED');
    const sealed = user.totpSecretEncrypted;
    if (sealed === null) return undefined;
    return { sealed, secret: await this.cipher.decrypt(sealed, secretContextOf(userId)) };
  }

  /** Under the lock: whether the pending secret is still the one opened, and not yet in force. */
  async isStillPending(userId: string, sealed: string): Promise<boolean> {
    await this.lock(userId);
    const user = await this.txHost.tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpSecretEncrypted: true, totpEnabledAt: true },
    });
    if (user.totpEnabledAt !== null) throw new DomainException('MFA_ALREADY_ENABLED');
    return user.totpSecretEncrypted === sealed;
  }

  private async spendRecoveryCode(userId: string, codeHash: string | undefined): Promise<boolean> {
    if (codeHash === undefined) return false;
    const { count } = await this.txHost.tx.mfaRecoveryCode.updateMany({
      where: { userId, codeHash, usedAt: null },
      data: { usedAt: dbInstantOf(this.clock.now()) },
    });
    return count === 1;
  }

  /** Keyed with the auth secret and bound to the account: the table alone opens nothing. */
  private recoveryHashOf(userId: string, code: string): Promise<string> {
    return this.secrets.derive('recovery-code', `${userId}:${code}`);
  }

  private async lock(userId: string): Promise<void> {
    await this.txHost.tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }
}
