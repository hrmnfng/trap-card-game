import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the platform-agnostic core is unit-tested here (no Expo/RN runtime).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
