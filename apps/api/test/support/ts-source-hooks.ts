import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as SwcCore from '@swc/core';

/**
 * Lets Node run the API's TypeScript sources in a child process, for child-process tests
 * (`node --import <URL of this file> <file>.ts`, 02 §12). It compiles each source of the API with
 * SWC and the API's `.swcrc`, as `nest build` does, so decorators and their metadata work and a
 * child process can run `src/main.ts` itself. The sources import each other with `.js` suffixes
 * (02 §1), which this hook resolves to the `.ts` files next to them.
 */
const API_DIR = fileURLToPath(new URL('../../', import.meta.url));
const swc = createRequire(import.meta.url)('@swc/core') as typeof SwcCore;
const swcrc = JSON.parse(readFileSync(path.join(API_DIR, '.swcrc'), 'utf8')) as SwcCore.Options;

function isApiSource(url: string): boolean {
  if (!url.startsWith('file:') || !url.endsWith('.ts')) return false;
  const file = fileURLToPath(url);
  return file.startsWith(API_DIR) && !file.includes(`${path.sep}node_modules${path.sep}`);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelativeJs = /^\.\.?\//.test(specifier) && specifier.endsWith('.js');
    if (!isRelativeJs || context.parentURL?.endsWith('.ts') !== true) {
      return nextResolve(specifier, context);
    }
    return nextResolve(`${specifier.slice(0, -'.js'.length)}.ts`, context);
  },
  load(url, context, nextLoad) {
    if (!isApiSource(url)) return nextLoad(url, context);
    const filename = fileURLToPath(url);
    const { code } = swc.transformSync(readFileSync(filename, 'utf8'), {
      ...swcrc,
      swcrc: false,
      filename,
      sourceMaps: 'inline',
    });
    return { format: 'module', source: code, shortCircuit: true };
  },
});
