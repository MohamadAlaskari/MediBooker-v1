import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lineReader, type LineInput } from './lines.ts';

const BACKSPACE = String.fromCharCode(127);
const OLD_BACKSPACE = String.fromCharCode(8);
const CTRL_C = String.fromCharCode(3);

/** A terminal in a test: keys arrive one chunk at a time and Enter sends a carriage return. */
function terminal() {
  const stream = new PassThrough();
  const modes: boolean[] = [];
  const input: LineInput = Object.assign(stream, {
    isTTY: true,
    setRawMode: (mode: boolean) => modes.push(mode),
  });
  return { input, modes, press: (keys: string) => stream.write(keys) };
}

let written: string;

beforeEach(() => {
  written = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('askHidden on a terminal', () => {
  it('turns the echo off only for this question, and never prints what was typed', async () => {
    const { input, modes, press } = terminal();
    const lines = lineReader(input);
    const answer = lines.askHidden('Passwort: ');
    press('sec');
    press('ret\r');
    await expect(answer).resolves.toBe('secret');
    expect(modes).toEqual([true, false]);
    expect(written).toBe('Passwort: \n');
    lines.close();
  });

  it('lets the backspace key correct a typing error, in both forms', async () => {
    const { input, press } = terminal();
    const lines = lineReader(input);
    const answer = lines.askHidden('Passwort: ');
    press(`seX${BACKSPACE}cY${OLD_BACKSPACE}ret\r`);
    await expect(answer).resolves.toBe('secret');
    lines.close();
  });

  it('cancels with Ctrl+C at once, and the next answer starts clean', async () => {
    const { input, modes, press } = terminal();
    const lines = lineReader(input);
    const answer = lines.askHidden('Passwort: ');
    press(`half-typed${CTRL_C}`);
    await expect(answer).resolves.toBeUndefined();
    expect(modes).toEqual([true, false]);
    const next = lines.ask('Auswahl: ');
    press('3\r');
    await expect(next).resolves.toBe('3');
    lines.close();
  });

  it('reports the end of the input', async () => {
    const { input } = terminal();
    const lines = lineReader(input);
    const answer = lines.askHidden('Passwort: ');
    lines.close();
    await expect(answer).resolves.toBeUndefined();
  });
});

describe('askHidden on a pipe', () => {
  it('reads a line and never switches a mode a pipe does not have', async () => {
    const stream = new PassThrough();
    const lines = lineReader(stream);
    const answer = lines.askHidden('Passwort: ');
    stream.write('from-a-pipe\n');
    await expect(answer).resolves.toBe('from-a-pipe');
    lines.close();
  });
});
