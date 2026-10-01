import { defineConfig } from 'vitest/config';

// `npm run sim` : rapport d'équilibrage (matchs IA contre IA), hors tests unitaires.
export default defineConfig({
  test: { include: ['tests/sim/**/*.test.ts'], testTimeout: 120_000 },
});
