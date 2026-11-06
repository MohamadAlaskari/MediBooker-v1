export type Direction = 'rtl' | 'ltr';

/** Languages written from right to left, also those that are not supported yet. */
const RIGHT_TO_LEFT: ReadonlySet<string> = new Set(['ar', 'fa', 'he', 'ur']);

export function getDirection(locale: string): Direction {
  return RIGHT_TO_LEFT.has(locale) ? 'rtl' : 'ltr';
}
