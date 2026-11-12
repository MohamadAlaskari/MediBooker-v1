import { describe, expect, it } from 'vitest';
import { THEMES, themeCookie, themeOf } from './theme';

describe('the theme of the pages (03 §6, B06)', () => {
  it('takes one of the three, and the system for anything else', () => {
    for (const theme of THEMES) expect(themeOf(theme)).toBe(theme);
    for (const other of [undefined, null, '', 'Dark', 'blue', 'dark; Path=/x']) {
      expect(themeOf(other)).toBe('system');
    }
  });

  it('keeps a choice for a year on every path, and only over HTTPS where the site has it', () => {
    expect(themeCookie('dark', true)).toBe(
      'theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    );
    expect(themeCookie('light', false)).toBe('theme=light; Path=/; Max-Age=31536000; SameSite=Lax');
  });
});
