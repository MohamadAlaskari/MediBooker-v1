import { describe, expect, it } from 'vitest';
import {
  createColorTheme,
  type BrandPreset,
  type ColorScheme,
  type ColorTheme,
} from './color-theme.js';
import { contrastRatio } from './contrast.js';
import { BRAND_PRESETS } from './generated/tokens.js';

const PRESETS = Object.keys(BRAND_PRESETS) as BrandPreset[];
const SCHEMES: readonly ColorScheme[] = ['light', 'dark'];
const CASES = PRESETS.flatMap((preset) => SCHEMES.map((scheme) => ({ preset, scheme })));

/** The measured table of the design-system skill (ADR 0002). */
const CONTRAST_TABLE: Readonly<Record<BrandPreset, readonly number[]>> = {
  //        button, link, focus (light); button, link, focus (dark)
  teal: [5.22, 6.72, 4.91, 7.59, 9.49, 7.59],
  ocean: [6.23, 7.76, 5.86, 6.42, 8.28, 6.42],
  indigo: [7.12, 8.75, 6.7, 5.38, 7.33, 5.38],
  violet: [6.95, 8.5, 6.54, 5.62, 7.54, 5.62],
  graphite: [6.78, 8.44, 6.38, 6.08, 8.16, 6.08],
};

function themeOf(preset: BrandPreset, scheme: ColorScheme): ColorTheme {
  return createColorTheme(scheme, BRAND_PRESETS[preset]);
}

type Pair = readonly [label: string, foreground: string, background: string];

function surfacesOf(theme: ColorTheme): readonly (readonly [string, string])[] {
  return [
    ['bg/canvas', theme.bg.canvas],
    ['bg/surface', theme.bg.surface],
    ['bg/surface-raised', theme.bg.surfaceRaised],
  ];
}

function onSurfaces(
  theme: ColorTheme,
  foregrounds: readonly (readonly [string, string])[],
  extra: readonly (readonly [string, string])[] = [],
): Pair[] {
  return foregrounds.flatMap(([label, color]) =>
    [...surfacesOf(theme), ...extra].map(([background, value]): Pair => [
      `${label} on ${background}`,
      color,
      value,
    ]),
  );
}

function textPairs(theme: ColorTheme): Pair[] {
  const { bg, text } = theme;
  const subtle = [['bg/subtle', bg.subtle]] as const;
  return [
    ...onSurfaces(
      theme,
      [
        ['text/primary', text.primary],
        ['text/secondary', text.secondary],
        ['text/brand', text.brand],
        ['text/danger', text.danger],
        ['text/success', text.success],
        ['text/warning', text.warning],
        ['text/info', text.info],
      ],
      subtle,
    ),
    // Not on bg/subtle: 4.43:1 in light, so meta text on a hover row uses text/secondary.
    ...onSurfaces(theme, [['text/tertiary', text.tertiary]]),
    ['text/on-brand on bg/brand', text.onBrand, bg.brand],
    ['text/on-brand on bg/brand-hover', text.onBrand, bg.brandHover],
    ['text/on-brand on bg/brand-pressed', text.onBrand, bg.brandPressed],
    ['text/on-danger on bg/danger', text.onDanger, bg.danger],
    ['text/on-danger on bg/danger-hover', text.onDanger, bg.dangerHover],
    ['text/inverse on bg/inverse', text.inverse, bg.inverse],
    ['text/brand on bg/brand-subtle', text.brand, bg.brandSubtle],
    ['text/brand on bg/brand-muted', text.brand, bg.brandMuted],
    ['text/danger on bg/danger-subtle', text.danger, bg.dangerSubtle],
    ['text/success on bg/success-subtle', text.success, bg.successSubtle],
    ['text/warning on bg/warning-subtle', text.warning, bg.warningSubtle],
    ['text/info on bg/info-subtle', text.info, bg.infoSubtle],
  ];
}

function graphicPairs(theme: ColorTheme): Pair[] {
  const { bg, border, icon } = theme;
  return [
    ...onSurfaces(
      theme,
      [
        ['icon/primary', icon.primary],
        ['icon/secondary', icon.secondary],
        ['icon/brand', icon.brand],
        ['icon/danger', icon.danger],
        ['icon/success', icon.success],
        ['icon/warning', icon.warning],
        ['icon/info', icon.info],
        ['border/strong', border.strong],
        ['border/brand', border.brand],
        ['border/danger', border.danger],
        ['border/focus', border.focus],
      ],
      [['bg/subtle', bg.subtle]],
    ),
    ['icon/on-brand on bg/brand', icon.onBrand, bg.brand],
    ['icon/on-danger on bg/danger', icon.onDanger, bg.danger],
    ['icon/inverse on bg/inverse', icon.inverse, bg.inverse],
  ];
}

describe('contrastRatio', () => {
  it('spans 1 to 21 and does not depend on the order', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#0b7a6e', '#0b7a6e')).toBe(1);
  });

  it.each(['#fff', '#0d11168f', 'red', ''])('refuses %j', (color) => {
    expect(() => contrastRatio(color, '#ffffff')).toThrow(RangeError);
  });
});

describe('the contrast table of the presets', () => {
  it.each(PRESETS)('%s reproduces its row (±0.01)', (preset) => {
    const light = themeOf(preset, 'light');
    const dark = themeOf(preset, 'dark');
    const measured = [
      contrastRatio(light.text.onBrand, light.bg.brand),
      contrastRatio(light.text.brand, light.bg.canvas),
      contrastRatio(light.border.focus, light.bg.canvas),
      contrastRatio(dark.text.onBrand, dark.bg.brand),
      contrastRatio(dark.text.brand, dark.bg.surface),
      contrastRatio(dark.border.focus, dark.bg.canvas),
    ];
    measured.forEach((ratio, index) => {
      expect(Math.abs(ratio - (CONTRAST_TABLE[preset][index] ?? 0))).toBeLessThanOrEqual(0.01);
    });
  });
});

describe('semantic pairs', () => {
  it.each(CASES)('$preset $scheme: every text pair is at least 4.5:1', ({ preset, scheme }) => {
    const failing = textPairs(themeOf(preset, scheme)).filter(
      ([, foreground, background]) => contrastRatio(foreground, background) < 4.5,
    );
    expect(failing.map(([label]) => label)).toEqual([]);
  });

  it.each(CASES)('$preset $scheme: borders and icons are at least 3:1', ({ preset, scheme }) => {
    const failing = graphicPairs(themeOf(preset, scheme)).filter(
      ([, foreground, background]) => contrastRatio(foreground, background) < 3,
    );
    expect(failing.map(([label]) => label)).toEqual([]);
  });

  it('keeps the one known exception visible', () => {
    const { bg, text } = themeOf('teal', 'light');
    expect(contrastRatio(text.tertiary, bg.subtle)).toBeCloseTo(4.43, 2);
  });
});
