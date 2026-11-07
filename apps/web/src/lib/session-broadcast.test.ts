import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SessionBroadcast from './session-broadcast';

/** As the HTML standard has it: a message reaches every other object of that name, not its sender. */
class Channel extends EventTarget {
  static open: Channel[] = [];

  constructor(readonly name: string) {
    super();
    Channel.open.push(this);
  }

  postMessage(data: unknown): void {
    for (const other of Channel.open) {
      if (other !== this && other.name === this.name) {
        other.dispatchEvent(new MessageEvent('message', { data }));
      }
    }
  }
}

/** A tab: a document has its own copy of the module. */
async function newDocument(): Promise<typeof SessionBroadcast> {
  vi.resetModules();
  return import('./session-broadcast');
}

describe('session-broadcast', () => {
  beforeEach(() => {
    Channel.open = [];
    vi.stubGlobal('BroadcastChannel', Channel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tells every listener of another tab what happened', async () => {
    const elsewhere = await newDocument();
    const shell = vi.fn();
    const form = vi.fn();
    elsewhere.onSessionChangeElsewhere(shell);
    elsewhere.onSessionChangeElsewhere(form);
    const here = await newDocument();
    here.announceSignOut();
    expect(shell).toHaveBeenLastCalledWith('signed-out');
    expect(form).toHaveBeenLastCalledWith('signed-out');
    here.announceSignIn();
    expect(shell).toHaveBeenLastCalledWith('signed-in');
    expect(form).toHaveBeenLastCalledWith('signed-in');
  });

  it('does not tell the tab it happened in, which goes on by its own way', async () => {
    const here = await newDocument();
    const heard = vi.fn();
    here.onSessionChangeElsewhere(heard);
    here.announceSignOut();
    here.announceSignIn();
    expect(heard).not.toHaveBeenCalled();
  });

  it('stops telling a listener whose page has gone, and no other', async () => {
    const elsewhere = await newDocument();
    const gone = vi.fn();
    const staying = vi.fn();
    elsewhere.onSessionChangeElsewhere(gone)();
    elsewhere.onSessionChangeElsewhere(staying);
    (await newDocument()).announceSignOut();
    expect(gone).not.toHaveBeenCalled();
    expect(staying).toHaveBeenCalledOnce();
  });

  it('takes nothing else on the channel for a change', async () => {
    const heard = vi.fn();
    (await newDocument()).onSessionChangeElsewhere(heard);
    new Channel('medibooker-session').postMessage('something else');
    expect(heard).not.toHaveBeenCalled();
  });

  it('does without where a browser has no such channel', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const { announceSignIn, announceSignOut, onSessionChangeElsewhere } = await newDocument();
    expect(() => {
      announceSignOut();
      announceSignIn();
      onSessionChangeElsewhere(vi.fn())();
    }).not.toThrow();
  });
});
