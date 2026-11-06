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

  it('is empty without a published practice', () => {
    expect(sitemapEntries('https://site.example', [], ['ar', 'en'])).toEqual([]);
  });
});
