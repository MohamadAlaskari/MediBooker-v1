import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from '../../../test/support/in-memory-object-storage.js';
import { FixedClock } from '../../common/time/fixed-clock.js';
import { ObjectKey } from './object-key.js';
import { ObjectStorageError } from './object-storage.js';

const NOW = Temporal.Instant.from('2027-10-31T00:30:00Z');
const key = ObjectKey.of('0a1b2c3d-0000-4000-8000-00000000000f', 'attachments/first');
const BYTES = new Uint8Array([1, 2, 3]);

/** The port's rules run in its template methods; any adapter shows them. */
function storage(): InMemoryObjectStorage {
  return new InMemoryObjectStorage(new FixedClock(NOW));
}

describe('ObjectStorage', () => {
  describe('the lifetime of a signed URL (R02)', () => {
    it.each([1, 60, 300])('takes %i seconds and reads the time from the clock', async (seconds) => {
      const upload = await storage().signUpload(key, { contentType: 'image/png', seconds });
      expect(upload.expiresAt.equals(NOW.add({ seconds }))).toBe(true);
      const download = await storage().signDownload(key, {
        contentType: 'image/png',
        downloadName: 'a.png',
        seconds,
      });
      expect(download.expiresAt.equals(NOW.add({ seconds }))).toBe(true);
    });

    it.each([0, -1, 301, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'refuses %d seconds as a programming error',
      async (seconds) => {
        await expect(
          storage().signUpload(key, { contentType: 'image/png', seconds }),
        ).rejects.toThrow(new RangeError('a signed URL lives 1 to 300 seconds'));
        await expect(
          storage().signDownload(key, { contentType: 'image/png', downloadName: 'a', seconds }),
        ).rejects.toBeInstanceOf(RangeError);
      },
    );
  });

  describe('the content type', () => {
    it.each([
      'application/pdf',
      'image/jpeg',
      'image/svg+xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ])('takes %s', async (contentType) => {
      await expect(storage().put(key, BYTES, contentType)).resolves.toBeUndefined();
    });

    it.each([
      ['empty', ''],
      ['no subtype', 'application'],
      ['upper case', 'Application/PDF'],
      ['a parameter', 'text/plain; charset=utf-8'],
      ['a header injection', 'text/plain\r\nx-evil: 1'],
    ])('refuses %s in put, signUpload and signDownload', async (_name, contentType) => {
      const refused = new TypeError('not a content type');
      await expect(storage().put(key, BYTES, contentType)).rejects.toThrow(refused);
      await expect(storage().signUpload(key, { contentType, seconds: 60 })).rejects.toThrow(
        refused,
      );
      await expect(
        storage().signDownload(key, { contentType, downloadName: 'a.pdf', seconds: 60 }),
      ).rejects.toThrow(refused);
    });
  });

  describe('the download name, which travels in the URL', () => {
    it.each(['a', 'report-1.pdf', 'R_2027.10.31.pdf', 'a'.repeat(100)])(
      'takes %s',
      async (name) => {
        await expect(
          storage().signDownload(key, {
            contentType: 'application/pdf',
            downloadName: name,
            seconds: 60,
          }),
        ).resolves.toMatchObject({ method: 'GET' });
      },
    );

    it.each([
      ['empty', ''],
      ['too long', 'a'.repeat(101)],
      ['a leading dot', '.env'],
      ['a space, as a patient file name has', 'blood test.pdf'],
      ['Arabic', 'تحليل.pdf'],
      ['a quote, which would end the header value', 'a"b.pdf'],
      ['a path', '../a.pdf'],
      ['a new line', 'a.pdf\n'],
    ])('refuses %s', async (_name, downloadName) => {
      await expect(
        storage().signDownload(key, { contentType: 'application/pdf', downloadName, seconds: 60 }),
      ).rejects.toThrow(new TypeError('not a download name'));
    });
  });

  it('takes only a practice id for deleting everything of a practice', async () => {
    await expect(storage().deleteAllOf('../other')).rejects.toThrow(
      new TypeError('not a practice id'),
    );
  });
});

describe('ObjectStorageError', () => {
  it('says the failure and nothing else, with no cause', () => {
    const error = new ObjectStorageError('REFUSED', 403, 'AuthorizationFailure');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ObjectStorageError');
    expect(error.message).toBe('REFUSED');
    expect(error).toMatchObject({
      failure: 'REFUSED',
      providerStatus: 403,
      providerCode: 'AuthorizationFailure',
    });
    expect(error.cause).toBeUndefined();
    expect(inspect(error)).toContain('REFUSED');
  });

  it('needs neither a status nor a code', () => {
    const error = new ObjectStorageError('NOT_CONFIGURED');
    expect(error.providerStatus).toBeUndefined();
    expect(error.providerCode).toBeUndefined();
  });
});
