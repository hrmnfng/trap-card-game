import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
// Pool 0.8.x exposes defineWorkersConfig from the /config subpath.

export default defineWorkersConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
  },
});
