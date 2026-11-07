/**
 * Signing out or in in one tab reaches the others: on a shared computer no tab stays open with what
 * one person saw, under the cookies of whoever came next.
 */

const CHANNEL = 'medibooker-session';
const CHANGES = ['signed-out', 'signed-in'] as const;

export type SessionChange = (typeof CHANGES)[number];

function isChange(data: unknown): data is SessionChange {
  return CHANGES.some((change) => change === data);
}

/**
 * One object per document, for posting and for listening: an object does not receive its own messages,
 * but a second one in this document would, and a page leaving by its own way would hear itself.
 */
let documentChannel: BroadcastChannel | undefined;

function channel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  documentChannel ??= new BroadcastChannel(CHANNEL);
  return documentChannel;
}

export function announceSignOut(): void {
  channel()?.postMessage('signed-out' satisfies SessionChange);
}

export function announceSignIn(): void {
  channel()?.postMessage('signed-in' satisfies SessionChange);
}

/** Calls `onChange` when another tab signs out or in; the answer ends the listening. */
export function onSessionChangeElsewhere(onChange: (change: SessionChange) => void): () => void {
  const open = channel();
  if (open === undefined) return () => undefined;
  const listener = ({ data }: MessageEvent<unknown>): void => {
    if (isChange(data)) onChange(data);
  };
  open.addEventListener('message', listener);
  return () => {
    open.removeEventListener('message', listener);
  };
}
