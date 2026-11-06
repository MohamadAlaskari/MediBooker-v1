import { BRAND_PRESETS } from '@medibooker/design-tokens';
import { describe, expect, it } from 'vitest';
import { brandStyle } from './brand-style';

const CUSTOM = [
  '#fdf2f9',
  '#fbe6f4',
  '#f6c9e6',
  '#ef9fd2',
  '#e26cb5',
  '#c2428f',
  '#7a1f5c',
  '#651a4c',
  '#54163f',
  '#461335',
  '#2c0921',
];

describe('brandStyle', () => {
  it('writes the eleven steps of a preset', () => {
    const style = brandStyle({ preset: 'OCEAN', scale: [] });
    expect(style.startsWith(':root{')).toBe(true);
    expect(style).toContain(`--brand-600:${BRAND_PRESETS.ocean[600]}`);
    expect(style.match(/--brand-/g)).toHaveLength(11);
  });

  it('prefers the scale of a custom colour', () => {
    const style = brandStyle({ preset: 'TEAL', scale: CUSTOM });
    expect(style).toContain('--brand-50:#fdf2f9');
    expect(style).toContain('--brand-600:#7a1f5c');
    expect(style).toContain('--brand-950:#2c0921');
  });

  it.each([
    ['an injection', Array.from({ length: 11 }, () => '#000;}</style><script>')],
    ['too few steps', CUSTOM.slice(0, 10)],
    ['too many steps', [...CUSTOM, '#000000']],
    ['upper case hex', CUSTOM.map((value) => value.toUpperCase())],
    ['one bad step', [...CUSTOM.slice(0, 10), 'red']],
  ])('falls back to the preset for %s', (_, scale) => {
    const style = brandStyle({ preset: 'OCEAN', scale });
    expect(style).toBe(brandStyle({ preset: 'OCEAN', scale: [] }));
    expect(style).not.toContain('<');
  });

  it.each(['UNKNOWN', 'constructor', '__proto__', ''])('uses Teal for the preset %j', (preset) => {
    expect(brandStyle({ preset, scale: [] })).toContain(`--brand-600:${BRAND_PRESETS.teal[600]}`);
  });
});
