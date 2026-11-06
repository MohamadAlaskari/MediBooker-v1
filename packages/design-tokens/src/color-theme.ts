import { BRAND_PRESETS, COLOR_TOKENS } from './generated/tokens.js';

export type ColorScheme = keyof typeof COLOR_TOKENS;
export type BrandPreset = keyof typeof BRAND_PRESETS;
export type BrandStep = keyof (typeof BRAND_PRESETS)['teal'];

/** The eleven steps of a brand: a preset, or a custom scale of the practice. */
export type BrandScale = Readonly<Record<BrandStep, string>>;

type Tokens = (typeof COLOR_TOKENS)['light'];

/** The semantic colours as plain values: `theme.bg.canvas`, `theme.text.onBrand`. */
export type ColorTheme = {
  readonly [Group in keyof Tokens]: { readonly [Name in keyof Tokens[Group]]: string };
};

type Group = Readonly<Record<string, string | { readonly brand: number }>>;

function resolveGroup(group: Group, scale: Readonly<Record<number, string>>) {
  return Object.fromEntries(
    Object.entries(group).map(([name, value]) => [
      name,
      typeof value === 'string' ? value : scale[value.brand],
    ]),
  );
}

/** The colours of a scheme in a brand, for React Native and e-mails (05 §3.1). */
export function createColorTheme(
  scheme: ColorScheme,
  scale: BrandScale = BRAND_PRESETS.teal,
): ColorTheme {
  return Object.fromEntries(
    Object.entries<Group>(COLOR_TOKENS[scheme]).map(([name, group]) => [
      name,
      resolveGroup(group, scale),
    ]),
  ) as unknown as ColorTheme;
}
