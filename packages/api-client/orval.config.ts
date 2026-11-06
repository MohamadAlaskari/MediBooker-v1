import { defineConfig } from 'orval';

const OPENAPI_DOCUMENT = '../../apps/api/openapi.json';

/** `pnpm --filter @medibooker/api-client generate`; the output is committed (api-contract skill). */
export default defineConfig({
  client: {
    input: { target: OPENAPI_DOCUMENT },
    output: {
      mode: 'tags-split',
      target: 'src/generated/endpoints',
      schemas: 'src/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      indexFiles: true,
      // A declared header such as Accept-Language becomes a typed argument.
      headers: true,
      mock: { indexMockFiles: true, generators: [{ type: 'msw' }] },
      override: {
        // apiFetch throws ApiError on any failure, so a call resolves with the body alone.
        fetch: { includeHttpResponseReturnType: false },
        mutator: { path: 'src/http/fetcher.ts', name: 'apiFetch' },
      },
    },
  },
  zod: {
    input: { target: OPENAPI_DOCUMENT },
    output: {
      mode: 'tags-split',
      target: 'src/generated/zod',
      client: 'zod',
      fileExtension: '.zod.ts',
      clean: true,
      indexFiles: true,
    },
  },
});
