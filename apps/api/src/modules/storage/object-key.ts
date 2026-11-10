const PRACTICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** No dots, so no traversal and no file names: a key holds ids, and a provider's logs see keys. */
const PATH = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

const PATH_MAX_LENGTH = 200;

/** A wrong id is a programming error. The message never repeats the value, which could be anything. */
export function assertPracticeId(practiceId: string): void {
  if (!PRACTICE_ID.test(practiceId)) throw new TypeError('not a practice id');
}

/**
 * Where an object lives, in no provider's terms: how a key maps to a provider is its adapter's
 * business. Every object belongs to a practice, so nothing can be asked for without saying whose it
 * is (ADR 0005).
 */
export class ObjectKey {
  /** Makes the type nominal: an object with the same two fields is no key, only `of` makes one. */
  declare private readonly nominal: never;

  private constructor(
    readonly practiceId: string,
    readonly path: string,
  ) {}

  static of(practiceId: string, path: string): ObjectKey {
    assertPracticeId(practiceId);
    if (path.length > PATH_MAX_LENGTH || !PATH.test(path)) {
      throw new TypeError('not an object path');
    }
    return new ObjectKey(practiceId, path);
  }
}
