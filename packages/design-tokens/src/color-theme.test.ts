import { describe, expect, it } from 'vitest';
import { createColorTheme, type BrandScale } from './color-theme.js';
import { BRAND_PRESETS } from './generated/tokens.js';

/** The nine tokens that follow a practice's brand (ADR 0002). */
const BRAND_FOLLOWING: Readonly<Record<string, readonly string[]>> = {
  bg: ['brand', 'brandHover', 'brandPressed', 'brandSubtle', 'brandMuted'],
  text: ['brand'],
  border: ['brand', 'focus'],
  icon: ['brand'],
};

function neutralsOf(theme: object): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(theme as Record<string, Record<string, string>>).map(([group, tokens]) => [
      group,
      Object.fromEntries(
        Object.entries(tokens).filter(([name]) => !BRAND_FOLLOWING[group]?.includes(name)),
      ),
    ]),
  );
}

describe('createColorTheme', () => {
  it('defaults to the Teal brand', () => {
    expect(createColorTheme('light')).toEqual(createColorTheme('light', BRAND_PRESETS.teal));
    expect(createColorTheme('light').bg.brand).toBe('#0b7a6e');
  });

  it('resolves the semantic tokens of a scheme', () => {
    const light = createColorTheme('light');
    expect(light.bg.canvas).toBe('#f7f8fa');
    expect(light.text.primary).toBe('#171c22');
    expect(light.bg.overlay).toBe('#0d11168f');

    const dark = createColorTheme('dark');
    expect(dark.bg.canvas).toBe('#0d1116');
    expect(dark.bg.surfaceRaised).toBe('#262d36');
    expect(dark.text.onBrand).toBe('#0d1116');
  });

  it('takes the brand tokens from the given scale', () => {
    const ocean = BRAND_PRESETS.ocean;
    expect(createColorTheme('light', ocean).bg.brand).toBe(ocean[600]);
    expect(createColorTheme('light', ocean).text.brand).toBe(ocean[700]);
    expect(createColorTheme('dark', ocean).bg.brand).toBe(ocean[400]);
    expect(createColorTheme('dark', ocean).border.focus).toBe(ocean[400]);
  });

  it('changes exactly the nine brand tokens between presets', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const teal = createColorTheme(scheme, BRAND_PRESETS.teal);
      const violet = createColorTheme(scheme, BRAND_PRESETS.violet);
      expect(neutralsOf(violet)).toEqual(neutralsOf(teal));
      for (const [group, names] of Object.entries(BRAND_FOLLOWING)) {
        for (const name of names) {
          const of = (theme: object) =>
            (theme as Record<string, Record<string, string>>)[group]?.[name];
          expect(of(violet)).not.toBe(of(teal));
        }
      }
    }
  });

  it('accepts a custom scale', () => {
    const custom: BrandScale = { ...BRAND_PRESETS.teal, 600: '#123456' };
    expect(createColorTheme('light', custom).bg.brand).toBe('#123456');
  });

  it('returns only plain values', () => {
    const values = Object.values(createColorTheme('dark')).flatMap((group: object) =>
      Object.values(group as Record<string, string>),
    );
    expect(values.length).toBe(51);
    expect(values.every((value) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(value))).toBe(true);
  });
});
