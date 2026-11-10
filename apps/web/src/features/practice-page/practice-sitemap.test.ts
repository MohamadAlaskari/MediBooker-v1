import { describe, expect, it } from 'vitest';
import { sitemapEntries } from './practice-sitemap';

describe('sitemapEntries', () => {
  it('gives each practice one address per language, each naming the others', () => {
    const languages = {
      ar: 'https://site.example/ar/al-noor',
      en: 'https://site.example/en/al-noor',
    };
    expect(sitemapEntries('https://site.example', ['al-noor'], ['ar', 'en'])).toEqual([
      { url: languages.ar, alternates: { languages } },
      { url: languages.en, alternates: { languages } },
    ]);
  });

  it("names an installation's practice at the root of its domain (ADR 0016)", () => {
    const atRoot = (locale: string): string => `/${locale}`;
    const languages = { ar: 'https://site.example/ar', en: 'https://site.example/en' };
    expect(sitemapEntries('https://site.example', ['al-noor'], ['ar', 'en'], atRoot)).toEqual([
      { url: languages.ar, alternates: { languages } },
      { url: languages.en, alternates: { languages } },
    ]);
  });

  it('is empty without a published practice', () => {
    expect(sitemapEntries('https://site.example', [], ['ar', 'en'])).toEqual([]);
  });
});
