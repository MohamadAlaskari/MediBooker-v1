import type { AnchorHTMLAttributes, MouseEvent, ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkipLink } from './skip-link';

/** What pressing the link does when the address ends in this fragment. */
function pressAt(hash: string): { readonly leftAlone: boolean; readonly focused: boolean } {
  const main = { focus: vi.fn() };
  vi.stubGlobal('window', { location: { hash } });
  vi.stubGlobal('document', { getElementById: (id: string) => (id === 'main' ? main : null) });
  const preventDefault = vi.fn();
  const link = SkipLink({ children: 'Skip' }) as ReactElement<
    AnchorHTMLAttributes<HTMLAnchorElement>
  >;
  expect(link.props.href).toBe('#main');
  link.props.onClick?.({ preventDefault } as unknown as MouseEvent<HTMLAnchorElement>);
  return {
    leftAlone: preventDefault.mock.calls.length === 0,
    focused: main.focus.mock.calls.length === 1,
  };
}

describe('SkipLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['#next=%2Fen%2Fbook%2Fal-noor', '#token=a-synthetic-token'])(
    'keeps %s in the address, and only moves the focus',
    (hash) => {
      expect(pressAt(hash)).toEqual({ leftAlone: false, focused: true });
    },
  );

  it.each(['', '#free-times', '#main'])('stays a plain link at %j', (hash) => {
    expect(pressAt(hash)).toEqual({ leftAlone: true, focused: false });
  });
});
