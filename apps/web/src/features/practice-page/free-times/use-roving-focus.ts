'use client';

import type { KeyboardEvent } from 'react';
import { nextRovingIndex } from './free-times-view';

/** The element that holds a row of choices. */
export const ROVING_GROUP = { 'data-roving-group': '' } as const;
/** What takes part in its row: an element with this attribute that is not disabled. */
export const ROVING_ITEM = { 'data-roving': '' } as const;

/**
 * One Tab stop for a row of choices, and the arrow keys within it, in reading direction: the
 * handler for each choice. With `selectOnMove` the arrow also chooses, as in a radio group.
 */
export function useRovingFocus(options?: {
  readonly selectOnMove?: boolean;
}): (event: KeyboardEvent<HTMLElement>) => void {
  const selectOnMove = options?.selectOnMove === true;
  return (event) => {
    const container = event.currentTarget.closest<HTMLElement>('[data-roving-group]');
    if (container === null) return;
    const items = [...container.querySelectorAll<HTMLElement>('[data-roving]:not(:disabled)')];
    const current = items.indexOf(event.currentTarget);
    const direction = getComputedStyle(container).direction === 'rtl' ? 'rtl' : 'ltr';
    const next = nextRovingIndex(current, event.key, items.length, direction);
    const target = next === undefined ? undefined : items[next];
    if (target === undefined) return;
    event.preventDefault();
    for (const item of items) item.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
    if (selectOnMove && next !== current) target.click();
  };
}
