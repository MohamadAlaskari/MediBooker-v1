import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { isLocalOrCi } from '../lib/app-env.ts';
import { requireSecretStore, runAudited } from '../lib/command.ts';
import { toErrorCode, ToolError, type ErrorCode } from '../lib/errors.ts';
import { practiceNames } from '../lib/names.ts';
import { elapsedMs } from '../lib/output.ts';
import { readPractice, readSlug, reservePractice } from '../lib/registry.ts';
import { isPracticeName, slugProblem } from '../lib/slugs.ts';
import { provision, type ProvisionOptions, type ProvisionResult } from './provision.ts';

/**
 * The lock key of creating a practice ('mbpc'): one session-level advisory lock on the command's
 * own platform connection, so two runs never pick, reserve or provision a practice at once. The
 * migration runner has its own key.
 */
const PRACTICE_CREATE_LOCK_KEY = 0x6d_62_70_63;

export interface PracticeCreateOptions extends Omit<ProvisionOptions, 'practiceId' | 'stopAfter'> {
  /** `--slug`: what PRACTICE_SLUG will name (ADR 0016). */
  readonly slug: string;
  /** `--name-ar`, `--name-en`: the practice's name as its page and its e-mails show it. */
  readonly names: { readonly ar: string; readonly en: string };
  /** Test seam: the id of a new practice. */
  readonly newPracticeId?: () => string;
}

export interface PracticeCreateResult extends ProvisionResult {
  /** The practice that was created or completed; undefined when none was chosen. */
  readonly practiceId: string | undefined;
}

/**
 * The practice an address name leads to: none yet, so a new one; or the one an earlier run reserved
 * and did not finish, which this run completes. A name another practice has or had is not reused.
 * Read under the command's lock, and checked again inside the reservation.
 */
async function practiceToCreate(platform: Client, options: PracticeCreateOptions): Promise<string> {
  const owner = await readSlug(platform, options.slug);
  if (owner === undefined) return (options.newPracticeId ?? randomUUID)();
  const practice = await readPractice(platform, owner.practiceId);
  if (owner.retired || practice === undefined) throw new ToolError('SLUG_TAKEN');
  if (practice.status !== 'PROVISIONING') throw new ToolError('PRACTICE_EXISTS');
  if (practice.market !== options.market) throw new ToolError('PRACTICE_MARKET_MISMATCH');
  return practice.id;
}

/**
 * `medibooker-db practice create --slug <slug> --name-ar <name> --name-en <name> --market <CC>
 * [--cluster <id>] [--time-zone <IANA>] [--default-locale <locale>]` (A04): the practice of a new
 * installation in one command. Under its lock it picks the practice, makes sure both secrets
 * resolve, reserves the registry row with the address name and the names, and provisions exactly as
 * `provision` does, whose lines it passes on. The page stays unpublished until the practice's admin
 * publishes it (M01). One pair of audit rows covers the whole run, also a refusal; `provision` adds
 * its own, which name the practice. Rerunning it after a failure completes the practice; rerunning
 * it after a success is PRACTICE_EXISTS and changes nothing; a second run at the same time is
 * RUNNER_BUSY.
 */
export async function practiceCreate(
  options: PracticeCreateOptions,
): Promise<PracticeCreateResult> {
  const start = performance.now();
  let practiceId: string | undefined;
  let errorCode: ErrorCode | null;
  let provisioned: ProvisionResult | undefined;
  try {
    // What the command line holds is judged first, like a wrong command line: nothing is read.
    if (slugProblem(options.slug) !== undefined) throw new ToolError('SLUG_NOT_ALLOWED');
    if (!isPracticeName(options.names.ar) || !isPracticeName(options.names.en)) {
      throw new ToolError('INVALID_ARGUMENTS');
    }
    if (!isLocalOrCi(options.appEnv) && options.markets?.includes(options.market) !== true) {
      throw new ToolError('MARKET_NOT_ALLOWED');
    }
    const store = requireSecretStore(options.secretStore);
    errorCode = await runAudited(
      options,
      { action: 'medibooker-db.practice.create', practiceId: null },
      async (platform) => {
        const locked = await platform.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS locked',
          [PRACTICE_CREATE_LOCK_KEY],
        );
        if (locked.rows[0]?.locked !== true) return 'RUNNER_BUSY';
        try {
          const chosen = await practiceToCreate(platform, options);
          practiceId = chosen;
          // Every secret the practice needs, before its first row (02 §6).
          const names = practiceNames(chosen);
          await store.ensure(names.appSecretRef);
          await store.ensure(names.ownerSecretRef);
          await reservePractice(platform, {
            practiceId: chosen,
            market: options.market,
            slug: options.slug,
            name: { ar: options.names.ar.trim(), en: options.names.en.trim() },
          });
          provisioned = await provision({ ...options, practiceId: chosen });
          return provisioned.errorCode;
        } finally {
          // Ending the connection releases it too; this frees it at once.
          await platform
            .query('SELECT pg_advisory_unlock($1)', [PRACTICE_CREATE_LOCK_KEY])
            .catch(() => undefined);
        }
      },
    );
  } catch (error) {
    errorCode = toErrorCode(error);
  }
  options.output.write({
    command: 'practice create',
    practices: practiceId === undefined ? 0 : 1,
    failed: errorCode === null ? 0 : 1,
    durationMs: elapsedMs(start),
    errorCode,
    ...(practiceId === undefined ? {} : { practiceId, slug: options.slug }),
  });
  return {
    exitCode: errorCode === null ? 0 : 1,
    errorCode,
    practice: errorCode === null ? provisioned?.practice : undefined,
    practiceId,
  };
}
