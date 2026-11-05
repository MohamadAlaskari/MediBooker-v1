import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { serializeError, serializeRequest, serializeResponse } from './serializers.js';

/** A request as pino-http hands it to the serializer: the raw Node request (02 §8). */
function rawRequest(fields: object): IncomingMessage {
  return Object.assign(new IncomingMessage(new Socket()), {
    id: '0b5c1f3e-9a2d-4c6b-8e7f-1a2b3c4d5e6f',
    method: 'GET',
    url: '/api/v1/probe/protected/secret-value?email=sara@example.test',
    originalUrl: '/api/v1/probe/protected/secret-value?email=sara@example.test',
    query: { email: 'sara@example.test' },
    headers: { authorization: 'Bearer secret-value', cookie: 'sid=secret-value' },
    ...fields,
  });
}

class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code: unknown,
    readonly detail: string,
    readonly meta: object,
  ) {
    super(message, { cause: new Error('cause with sara@example.test') });
  }
}

const MARKERS = /secret-value|sara@example\.test|duplicate|second/;

/** A message line in the exact form of a V8 frame with a location, carrying an e-mail address. */
const FRAME_LIKE_LINE = '    at check (sara@example.test:1:2)';

/** The frame lines of a real stack, without its header. */
function framesOf(error: Error): string {
  return (error.stack ?? '').split('\n').slice(1).join('\n');
}

/** An Error whose property throws when it is read. */
function errorWithFailingGetter(property: 'message' | 'stack' | 'code'): Error {
  const error = new Error('duplicate key for sara@example.test');
  Object.defineProperty(error, property, {
    enumerable: true,
    get: (): never => {
      throw new RangeError('secret-value');
    },
  });
  return error;
}

describe('serializeRequest', () => {
  it('keeps only id, method and the matched route pattern', () => {
    const logged = serializeRequest(rawRequest({ route: { path: '/api/v1/probe/protected/:id' } }));
    expect(logged).toEqual({
      id: '0b5c1f3e-9a2d-4c6b-8e7f-1a2b3c4d5e6f',
      method: 'GET',
      route: '/api/v1/probe/protected/:id',
    });
    expect(JSON.stringify(logged)).not.toMatch(/secret-value|sara@example\.test|Bearer/);
  });

  it.each(['{/*splat}', '/api/v1{/*splat}'])(
    'logs the middleware mount pattern %s of an unmatched request as null',
    (path) => {
      expect(serializeRequest(rawRequest({ route: { path } })).route).toBeNull();
    },
  );

  it.each([
    ['no route', {}],
    ['a route without a path', { route: {} }],
    ['a route with a regular expression', { route: { path: /x/ } }],
    ['a route that is not an object', { route: 'secret-value' }],
  ])('logs %s as null', (_case, fields) => {
    expect(serializeRequest(rawRequest(fields)).route).toBeNull();
  });

  it('logs a missing id or method as null, also for a value that is not a request', () => {
    expect(serializeRequest({})).toEqual({ id: null, method: null, route: null });
    expect(serializeRequest('secret-value')).toEqual({ id: null, method: null, route: null });
  });

  it('logs an id that is not a UUID and a method that is not an HTTP method as null', () => {
    const logged = serializeRequest(
      rawRequest({ id: 'sara@example.test', method: 'Sara Example' }),
    );
    expect(logged).toEqual({ id: null, method: null, route: null });
    expect(serializeRequest(rawRequest({ method: 'PROPFIND' })).method).toBe('PROPFIND');
  });

  it('reads the route only from a Node request: a hand-written { req } logs nulls', () => {
    const handWritten = {
      id: 'sara@example.test',
      method: 'Sara Example',
      route: { path: '/x/sara@example.test' },
    };
    expect(serializeRequest(handWritten)).toEqual({ id: null, method: null, route: null });
  });
});

describe('serializeResponse', () => {
  it('keeps only the status code', () => {
    const response = { statusCode: 404, getHeaders: () => ({ 'set-cookie': 'sid=secret-value' }) };
    expect(serializeResponse(response)).toEqual({ statusCode: 404 });
    expect(serializeResponse({})).toEqual({ statusCode: null });
    expect(serializeResponse(null)).toEqual({ statusCode: null });
  });
});

describe('serializeError', () => {
  const error = new DatabaseError(
    'duplicate key for sara@example.test\nsecond line with secret-value',
    'P2002',
    'Key (email)=(sara@example.test) already exists.',
    { target: ['email'], value: 'secret-value' },
  );

  it('keeps type, a string code and the stack frames; drops message, cause, detail and meta', () => {
    const logged = serializeError(error);
    expect(Object.keys(logged).sort()).toEqual(['code', 'stack', 'type']);
    expect(logged.type).toBe('DatabaseError');
    expect(logged.code).toBe('P2002');
    expect(logged.stack?.split('\n')[0]).toBe('DatabaseError');
    expect(logged.stack?.split('\n')[1]).toMatch(/^\s+at /);
    expect(JSON.stringify(logged)).not.toMatch(MARKERS);
  });

  it('drops every line of the header, also a message line that looks like a stack frame', () => {
    const disguised = new Error(
      'Unique constraint failed\n    at email sara@example.test (value secret-value)',
    );
    const logged = serializeError(disguised);
    expect(logged.stack).not.toMatch(/secret-value|sara@example\.test|Unique/);
    // The type line, then every frame: all lines of the original stack except its two header lines.
    const lines = logged.stack?.split('\n') ?? [];
    expect(lines[0]).toBe('Error');
    expect(lines.slice(1).every((line) => /^\s+at /.test(line))).toBe(true);
    expect(lines).toHaveLength(1 + (disguised.stack?.split('\n').length ?? 0) - 2);
  });

  it('drops a code that is not a string', () => {
    expect(serializeError(new DatabaseError('x', 23505, 'd', {}))).not.toHaveProperty('code');
  });

  it('names a thrown value that is not an error by its type only', () => {
    expect(serializeError('secret-value')).toEqual({ type: 'string' });
    expect(serializeError({ message: 'secret-value' })).toEqual({ type: 'object' });
  });

  it.each([
    ['a number', 42],
    ['an object', { email: 'sara@example.test' }],
    // V8 writes the header from the message's text: two lines, the second like a frame.
    [
      'an object whose text has a line that looks like a frame',
      { toString: () => 'Validation failed\n    at field sara@example.test (secret-value)' },
    ],
  ])(
    'counts the header of a message that is %s by its text and keeps the frames',
    (_case, message) => {
      const odd = Object.assign(new Error('duplicate key for sara@example.test'), { message });
      const logged = serializeError(odd);
      expect(logged.type).toBe('Error');
      expect(logged.stack?.split('\n')[0]).toBe('Error');
      expect(logged.stack?.split('\n').slice(1)).not.toEqual([]);
      expect(
        logged.stack
          ?.split('\n')
          .slice(1)
          .every((line) => /^\s+at /.test(line)),
      ).toBe(true);
      expect(JSON.stringify(logged)).not.toMatch(MARKERS);
    },
  );

  it.each(['message', 'stack', 'code'] as const)(
    'returns the type only when reading %s throws',
    (property) => {
      expect(serializeError(errorWithFailingGetter(property))).toEqual({ type: 'Error' });
    },
  );

  it('returns the type only when the message cannot be turned into text', () => {
    const odd = Object.assign(new Error('secret-value'), {
      message: Object.create(null) as object,
    });
    expect(serializeError(odd)).toEqual({ type: 'Error' });
  });

  it('logs a code only in the form of an error code', () => {
    for (const code of ['ERR_INVALID_ARG_TYPE', 'ECONNREFUSED', 'P2002', '23505']) {
      expect(serializeError(new DatabaseError('x', code, 'd', {})).code).toBe(code);
    }
    const logged = serializeError(new DatabaseError('x', 'bad sara@example.test', 'd', {}));
    expect(logged).not.toHaveProperty('code');
    expect(JSON.stringify(logged)).not.toMatch(MARKERS);
  });

  it('reads the type from the class, never from an own constructor property', () => {
    const forged = Object.assign(
      new Error('x'),
      JSON.parse('{"constructor":{"name":"sara@example.test"}}') as object,
    );
    expect(serializeError(forged)).toMatchObject({ type: 'Error' });
    expect(JSON.stringify(serializeError(forged))).not.toMatch(MARKERS);
  });

  it('names an error Error when its class cannot be read, and a value whose prototype cannot be read by its type', () => {
    class FailingClass extends Error {}
    Object.defineProperty(FailingClass.prototype, 'constructor', {
      get: (): never => {
        throw new RangeError('secret-value');
      },
    });
    expect(serializeError(new FailingClass('x')).type).toBe('Error');
    const unreadable = new Proxy(
      {},
      {
        getPrototypeOf: (): never => {
          throw new RangeError('secret-value');
        },
      },
    );
    expect(serializeError(unreadable)).toEqual({ type: 'object' });
  });

  it('names an error Error when its class name is not written like one', () => {
    const Renamed = class extends Error {};
    Object.defineProperty(Renamed, 'name', { value: 'sara@example.test' });
    expect(serializeError(new Renamed('x')).type).toBe('Error');
  });

  it.each([
    [
      'a name with a line like a frame',
      () => Object.assign(new Error('m'), { name: 'Foo\n    at sara@example.test' }),
    ],
    [
      'a message shortened after the stack was written',
      () => {
        const error = new Error('Failed to book\n    at field email=sara@example.test');
        // The first read of the stack makes V8 write its header from the long message.
        expect(error.stack).toContain('email=');
        error.message = 'Failed to book';
        return error;
      },
    ],
    [
      'the stack of another error, as nestjs-pino builds it for logger.error(message, stack)',
      () => {
        const original = new Error('Failed to book\n    at field email=sara@example.test');
        return Object.assign(new Error('Failed to book'), { stack: original.stack });
      },
    ],
    [
      "Node's header with the error code and a line like a frame with a location",
      () => {
        const error = Object.assign(new Error(`Validation failed\n${FRAME_LIKE_LINE}`), {
          code: 'ERR_INVALID_ARG_VALUE',
        });
        const frames = framesOf(new Error('x'));
        error.stack = `Error [ERR_INVALID_ARG_VALUE]: ${error.message}\n${frames}`;
        return error;
      },
    ],
  ])('keeps only frame lines of a stack with %s', (_case, errorOf) => {
    const logged = serializeError(errorOf());
    const lines = logged.stack?.split('\n') ?? [];
    expect(lines[0]).toBe('Error');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((line) => /^\s+at /.test(line))).toBe(true);
    expect(JSON.stringify(logged)).not.toMatch(MARKERS);
  });

  it('cuts the header Node writes for its own errors, Name [CODE]: message, and keeps the frames', () => {
    let nodeError: unknown;
    try {
      Buffer.alloc(-1);
    } catch (error) {
      nodeError = error;
    }
    expect(nodeError).toMatchObject({ code: 'ERR_OUT_OF_RANGE' });
    const lines = serializeError(nodeError).stack?.split('\n') ?? [];
    expect(lines[0]).toBe('RangeError');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((line) => /^\s+at /.test(line))).toBe(true);
  });

  it.each([
    [
      'its message replaced after the stack was written',
      () => {
        const error = new Error(`Validation failed\n${FRAME_LIKE_LINE}`);
        expect(error.stack).toContain(FRAME_LIKE_LINE);
        error.message = 'Something else failed';
        return error;
      },
    ],
    [
      'the stack of another error with a different first line',
      () => {
        const original = new TypeError(`cannot book\n${FRAME_LIKE_LINE}`);
        return Object.assign(new Error('Failed to book'), { stack: original.stack });
      },
    ],
    [
      'no frames at all (Error.stackTraceLimit 0, as also in fs errors of Node)',
      () => {
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 0;
        try {
          return new Error(`Validation failed\n${FRAME_LIKE_LINE}`);
        } finally {
          Error.stackTraceLimit = limit;
        }
      },
    ],
  ])('logs no frames of a stack whose header the error does not give: %s', (_case, errorOf) => {
    expect(serializeError(errorOf())).toEqual({ type: 'Error', stack: 'Error' });
  });

  it('keeps WebAssembly frames and a bare at <anonymous>', () => {
    const error = new Error('x');
    const wasmFrame = '    at wasm://wasm/0012abcd:wasm-function[3]:0x1f4';
    error.stack = `Error: x\n${wasmFrame}\n    at <anonymous>\n${framesOf(new Error('y'))}`;
    const lines = serializeError(error).stack?.split('\n') ?? [];
    expect(lines.slice(0, 3)).toEqual(['Error', wasmFrame, '    at <anonymous>']);
  });

  it('logs no frames when the stack is not a string', () => {
    const odd = Object.assign(new Error('x'), { stack: { toString: () => 'sara@example.test' } });
    expect(serializeError(odd)).toEqual({ type: 'Error', stack: 'Error' });
  });

  it('names an error Error when its class name cannot be read as text', () => {
    const failingConstructor = new Error('secret-value');
    Object.defineProperty(failingConstructor, 'constructor', {
      get: (): never => {
        throw new RangeError('secret-value');
      },
    });
    const Unnamed = class extends Error {};
    Object.defineProperty(Unnamed, 'name', { value: '' });
    expect(serializeError(failingConstructor).type).toBe('Error');
    expect(serializeError(new Unnamed('secret-value')).type).toBe('Error');
  });
});
