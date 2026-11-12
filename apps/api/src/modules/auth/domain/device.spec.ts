import { describe, expect, it } from 'vitest';
import { deviceOf } from './device.js';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/141.0.0.0`;
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0';
const SAMSUNG =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0';

describe('deviceOf', () => {
  it.each([
    [CHROME_WINDOWS, 'Chrome · Windows'],
    [EDGE_WINDOWS, 'Edge · Windows'],
    [SAFARI_IPHONE, 'Safari · iOS'],
    [CHROME_IPHONE, 'Chrome · iOS'],
    [FIREFOX_ANDROID, 'Firefox · Android'],
    [SAMSUNG, 'Samsung Internet · Android'],
    [SAFARI_MAC, 'Safari · macOS'],
    [FIREFOX_LINUX, 'Firefox · Linux'],
    ['MediBooker/1.0 (Android 15)', 'MediBooker App · Android'],
    ['curl/8.5.0', null],
    ['', null],
  ])('names %s as %j', (userAgent, device) => {
    expect(deviceOf(userAgent)).toBe(device);
  });

  it('names nothing without a User-Agent', () => {
    expect(deviceOf(undefined)).toBeNull();
  });

  it('never says more than 60 characters, the limit of its column', () => {
    const everything = [CHROME_WINDOWS, SAMSUNG, SAFARI_IPHONE].join(' ');
    expect(deviceOf(everything)?.length).toBeLessThanOrEqual(60);
    expect(deviceOf('x'.repeat(100_000))).toBeNull();
  });
});
