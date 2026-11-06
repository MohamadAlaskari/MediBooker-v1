import { typography } from '@medibooker/design-tokens';
import { describe, expect, it } from 'vitest';
import { cn, TYPE_STYLES } from './utils';

describe('cn', () => {
  it('keeps a type style next to a colour, which both start with text-', () => {
    expect(cn('text-label-large', 'text-text-brand')).toBe('text-label-large text-text-brand');
    expect(cn('text-text-brand', 'text-heading-h3')).toBe('text-text-brand text-heading-h3');
  });

  it('lets the last of two type styles or two colours win', () => {
    expect(cn('text-label-large', 'text-caption')).toBe('text-caption');
    expect(cn('text-text-primary', 'text-text-brand')).toBe('text-text-brand');
  });

  it('knows every type style of the design tokens', () => {
    const fromTokens = Object.keys(typography.en.styles).map((name) =>
      name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
    );
    expect([...TYPE_STYLES].sort()).toEqual(fromTokens.sort());
  });
});
