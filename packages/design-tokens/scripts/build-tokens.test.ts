import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { BRAND_PRESETS, borderWidth, motion, radius, spacing, typography } from '../src/index.ts';
import { buildTokens, CSS_FILE, TS_FILE } from './build-tokens.ts';

const { css, ts } = buildTokens();

/** The custom properties a rule declares, by name. */
function declarationsOf(selector: string, source: string = css): Map<string, string> {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No rule ${selector}`);
  const end = source.indexOf('}', start);
  const body = source.slice(start + selector.length + 2, end);
  return new Map(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1] ?? '', match[2] ?? '']),
  );
}

function semanticOf(declarations: ReadonlyMap<string, string>): Map<string, string> {
  return new Map(
    [...declarations].filter(([name]) => /^--color-(bg|text|border|icon)-/.test(name)),
  );
}

const lightTokens = semanticOf(declarationsOf('@theme static'));
const darkTokens = semanticOf(declarationsOf("[data-theme='dark']"));
const systemTokens = semanticOf(declarationsOf("  [data-theme='system']"));

describe('the build', () => {
  it('is deterministic', () => {
    const again = buildTokens();
    expect(again.css).toBe(css);
    expect(again.ts).toBe(ts);
  });

  it('matches the committed files', () => {
    expect(readFileSync(CSS_FILE, 'utf8')).toBe(css);
    expect(readFileSync(TS_FILE, 'utf8')).toBe(ts);
  });

  it('keeps the variable names and the motion exports stable', () => {
    const names = [...css.matchAll(/^\s*(--[\w-]+(?:\*)?):/gm)].map((match) => match[1]);
    expect([...new Set(names)]).toMatchSnapshot();
    expect(motion).toMatchSnapshot();
  });
});

describe('semantic colours', () => {
  it('has all 51 tokens in light and dark', () => {
    expect(lightTokens.size).toBe(51);
    expect([...darkTokens.keys()]).toEqual([...lightTokens.keys()]);
  });

  it('uses the dark values for the system theme too', () => {
    expect([...systemTokens]).toEqual([...darkTokens]);
  });

  it.each([
    ['light', lightTokens],
    ['dark', darkTokens],
  ])('lets only the nine brand tokens follow --brand-* in %s', (_, tokens) => {
    const following = [...tokens]
      .filter(([, value]) => value.startsWith('var(--brand-'))
      .map(([name]) => name);
    expect(following).toEqual([
      '--color-bg-brand',
      '--color-bg-brand-hover',
      '--color-bg-brand-pressed',
      '--color-bg-brand-subtle',
      '--color-bg-brand-muted',
      '--color-text-brand',
      '--color-border-brand',
      '--color-border-focus',
      '--color-icon-brand',
    ]);
  });

  it('references a primitive that exists from every token', () => {
    const plain = declarationsOf(':root');
    for (const value of [...lightTokens.values(), ...darkTokens.values()]) {
      expect(plain.has(value.slice('var('.length, -1))).toBe(true);
    }
  });
});

describe('brand presets', () => {
  const steps = Object.keys(BRAND_PRESETS.teal) as (keyof typeof BRAND_PRESETS.teal)[];

  it('defaults to the Teal scale', () => {
    const plain = declarationsOf(':root');
    for (const step of steps) {
      expect(plain.get(`--brand-${step}`)).toBe(BRAND_PRESETS.teal[step]);
    }
  });

  it.each(['ocean', 'indigo', 'violet', 'graphite'] as const)(
    '%s sets the eleven brand steps and nothing else',
    (preset) => {
      const declarations = declarationsOf(`[data-brand='${preset}']`);
      expect([...declarations.keys()]).toEqual(steps.map((step) => `--brand-${step}`));
      for (const step of steps) {
        expect(declarations.get(`--brand-${step}`)).toBe(BRAND_PRESETS[preset][step]);
      }
    },
  );
});

describe('typography', () => {
  it('chooses the font stack and line heights per language', () => {
    const arabic = declarationsOf(':lang(ar)');
    expect(arabic.get('--font-sans')).toBe(
      "var(--font-noto-sans-arabic, 'Noto Sans Arabic'), var(--font-inter, 'Inter'), sans-serif",
    );
    expect(arabic.get('--text-display--line-height')).toBe('3rem');

    const english = declarationsOf(':root,\n:lang(en)');
    expect(english.get('--font-sans')).toBe("var(--font-inter, 'Inter'), sans-serif");
    expect(english.get('--text-display--line-height')).toBe('2.5rem');
  });

  it('exports the same styles for React Native and e-mails', () => {
    expect(typography.ar.fontStack).toBe('"Noto Sans Arabic", "Inter", sans-serif');
    expect(typography.en.fontStack).toBe('"Inter", sans-serif');
    expect(typography.ar.styles.headingH1).toEqual({
      fontFamily: 'Noto Sans Arabic',
      fontSize: 28,
      lineHeight: 44,
      fontWeight: 700,
      letterSpacing: 0,
    });
    expect(typography.en.styles.labelSmall).toEqual({
      fontFamily: 'Inter',
      fontSize: 12,
      lineHeight: 16,
      fontWeight: 500,
      letterSpacing: 0,
    });
  });
});

describe('dimensions and motion', () => {
  it('exports numbers', () => {
    expect(spacing[4]).toBe(16);
    expect(radius.md).toBe(10);
    expect(radius.full).toBe(9999);
    expect(borderWidth.strong).toBe(2);
    expect(motion.duration.base).toBe(200);
    expect(motion.ease.enter).toEqual([0.05, 0.7, 0.1, 1]);
  });

  it('writes the matching CSS', () => {
    const theme = declarationsOf('@theme static');
    expect(theme.get('--spacing-4')).toBe('1rem');
    expect(theme.get('--radius-md')).toBe('10px');
    expect(theme.get('--breakpoint-tablet')).toBe('46.5rem');
    expect(theme.get('--breakpoint-desktop')).toBe('80rem');

    const plain = declarationsOf(':root');
    expect(plain.get('--motion-duration-fast')).toBe('120ms');
    expect(plain.get('--motion-ease-standard')).toBe('cubic-bezier(0.2, 0, 0, 1)');
  });
});

describe('a Tailwind compile of the stylesheet', () => {
  const tailwindRoot = dirname(fileURLToPath(import.meta.resolve('tailwindcss/package.json')));

  async function compiled(candidates: readonly string[]): Promise<string> {
    const compiler = await compile(
      "@import 'tailwindcss';\n@import '@medibooker/design-tokens/tokens.css';\n",
      {
        base: tailwindRoot,
        loadStylesheet: (id: string, base: string) => {
          const path =
            id === '@medibooker/design-tokens/tokens.css'
              ? CSS_FILE
              : id === 'tailwindcss'
                ? join(tailwindRoot, 'index.css')
                : join(base, id);
          return Promise.resolve({
            path,
            base: dirname(path),
            content: readFileSync(path, 'utf8'),
          });
        },
      },
    );
    return compiler.build([...candidates]);
  }

  const selectorOf = (candidate: string): string => `.${candidate.replace(/[\\:.]/g, '\\$&')}`;

  it.each([
    'bg-bg-canvas',
    'bg-bg-brand',
    'text-text-primary',
    'border-border-focus',
    'p-0',
    'p-4',
    'gap-2',
    'rounded-md',
    'rounded-full',
    'text-display',
    'text-body-default',
    'font-sans',
    'font-regular',
    'font-semibold',
    'shadow-elevation-1',
    'ease-standard',
    'max-w-page',
    'tablet:p-4',
    'desktop:p-4',
  ])('generates the token utility %s', async (candidate) => {
    expect(await compiled([candidate])).toContain(selectorOf(candidate));
  });

  it('gives p-4 the spacing token and a text style its token values', async () => {
    const output = await compiled(['p-4', 'text-display']);
    expect(output).toContain('padding: var(--spacing-4)');
    expect(output).toContain('font-size: var(--text-display)');
    expect(output).toContain('var(--text-display--line-height)');
    expect(output).toContain('var(--text-display--font-weight)');
  });

  it('removes the primitives and Tailwind defaults', async () => {
    const forbidden = [
      // Primitives never reach the colour namespace.
      'bg-gray-50',
      'bg-gray-950',
      'text-teal-600',
      'bg-brand-600',
      'border-ocean-500',
      'bg-alpha-scrim',
      // Tailwind's palette.
      'bg-red-500',
      'text-slate-900',
      'bg-white',
      'bg-black',
      // Tailwind's spacing multiplier.
      'p-7',
      'gap-3.5',
      'w-13',
      // Tailwind's radii, type, weights, shadows and eases.
      'rounded-xs',
      'rounded-2xl',
      'text-xs',
      'text-sm',
      'text-base',
      'text-lg',
      'font-serif',
      'font-mono',
      'font-thin',
      'font-black',
      'leading-tight',
      'tracking-wide',
      'shadow-sm',
      'shadow-lg',
      'ease-in-out',
      // Tailwind's breakpoints and containers.
      'sm:p-4',
      'md:p-4',
      'lg:p-4',
      'xl:p-4',
      'max-w-md',
    ];
    const output = await compiled(forbidden);
    expect(forbidden.filter((candidate) => output.includes(selectorOf(candidate)))).toEqual([]);
  });

  it('keeps the theme variables in the output, also when no utility uses them', async () => {
    const output = await compiled([]);
    expect(output).toContain('--color-text-tertiary:');
    expect(output).toContain('--radius-xl:');
  });
});
