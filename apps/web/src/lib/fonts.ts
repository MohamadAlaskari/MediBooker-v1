import localFont from 'next/font/local';

/**
 * Self-hosted, so no visitor's address reaches a font service (design-system skill). The token
 * stylesheet picks them per language through these variables.
 */
const inter = localFont({
  src: '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
});

const notoSansArabic = localFont({
  src: '../../node_modules/@fontsource-variable/noto-sans-arabic/files/noto-sans-arabic-arabic-wght-normal.woff2',
  variable: '--font-noto-sans-arabic',
  weight: '100 900',
  display: 'swap',
});

export const FONT_VARIABLES = `${inter.variable} ${notoSansArabic.variable}`;
