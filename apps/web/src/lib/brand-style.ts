import {
  BRAND_PRESETS,
  type BrandPreset,
  type BrandScale,
  type BrandStep,
} from '@medibooker/design-tokens';

const STEPS = Object.keys(BRAND_PRESETS.teal) as BrandStep[];
const HEX = /^#[0-9a-f]{6}$/;

export interface BrandTheme {
  readonly preset: string;
  /** Empty, or the eleven steps of a custom colour. */
  readonly scale: readonly string[];
}

function isPreset(name: string): name is BrandPreset {
  return Object.hasOwn(BRAND_PRESETS, name);
}

/** The custom scale when it is valid, else the preset; Teal when neither can be trusted. */
function scaleOf({ preset, scale }: BrandTheme): BrandScale {
  if (scale.length === STEPS.length && scale.every((value) => HEX.test(value))) {
    return Object.fromEntries(
      STEPS.map((step, index) => [step, scale[index] ?? '']),
    ) as unknown as BrandScale;
  }
  const name = preset.toLowerCase();
  return isPreset(name) ? BRAND_PRESETS[name] : BRAND_PRESETS.teal;
}

/**
 * The practice's colours as a stylesheet for a nonce'd `<style>` (03 §9). Only the eleven brand
 * steps change, so every component follows and the status colours stay. Values come from a database
 * a practice writes to, so nothing reaches the stylesheet unless it is a plain hex colour.
 */
export function brandStyle(theme: BrandTheme): string {
  const scale = scaleOf(theme);
  return `:root{${STEPS.map((step) => `--brand-${step}:${scale[step]}`).join(';')}}`;
}
