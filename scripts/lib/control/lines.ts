import { createInterface } from 'node:readline';

/** Ctrl+C on a raw terminal, which then arrives as text instead of a signal. */
const INTERRUPT = 3;
const INTERRUPT_TEXT = String.fromCharCode(INTERRUPT);
/** What a raw terminal sends for the backspace key, depending on the terminal. */
const ERASE: ReadonlySet<string> = new Set([String.fromCharCode(8), String.fromCharCode(127)]);

/** What was typed on a raw terminal: a backspace takes back the character before it. */
function typedTextOf(raw: string): string {
  const typed: string[] = [];
  for (const character of raw) {
    if (ERASE.has(character)) typed.pop();
    else typed.push(character);
  }
  return typed.join('');
}

/** The part of the terminal this reader needs: stdin, or a stand-in in a test. */
export type LineInput = NodeJS.ReadableStream & {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
};

/** Lines from stdin, also from a pipe; a child process gets the terminal while it runs. */
export function lineReader(input: LineInput = process.stdin) {
  const rl = createInterface({ input, terminal: false });
  const lines: string[] = [];
  let closed = false;
  let waiting: ((line: string | undefined) => void) | undefined;
  rl.on('line', (line) => {
    if (waiting === undefined) {
      lines.push(line);
    } else {
      const resume = waiting;
      waiting = undefined;
      resume(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    waiting?.(undefined);
    waiting = undefined;
  });

  /** The next answer; undefined when the input has ended. */
  const ask = (prompt: string): Promise<string | undefined> => {
    process.stdout.write(prompt);
    const line = lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (closed) return Promise.resolve(undefined);
    rl.resume();
    return new Promise((resolve) => {
      waiting = resolve;
    });
  };

  /**
   * Like `ask`, but the terminal does not show what is typed: raw mode turns its echo off, and with
   * it its line editing and Ctrl+C, which end up here. Ctrl+C cancels the question: undefined.
   */
  const askHidden = async (prompt: string): Promise<string | undefined> => {
    // A pipe shows nothing anyway.
    if (input.isTTY !== true || input.setRawMode === undefined) return ask(prompt);
    const onData = (chunk: string | Buffer): void => {
      // Ends the line, so what was typed so far leaves the reader's buffer with this answer.
      if (Buffer.from(chunk).includes(INTERRUPT)) rl.write('\n');
    };
    input.on('data', onData);
    input.setRawMode(true);
    try {
      const answer = await ask(prompt);
      if (answer === undefined || answer.includes(INTERRUPT_TEXT)) return undefined;
      return typedTextOf(answer);
    } finally {
      input.off('data', onData);
      input.setRawMode(false);
      process.stdout.write('\n');
    }
  };

  return {
    ask,
    askHidden,
    get isWaiting(): boolean {
      return waiting !== undefined;
    },
    pause(): void {
      rl.pause();
    },
    close(): void {
      rl.close();
    },
  };
}

export type LineReader = ReturnType<typeof lineReader>;
