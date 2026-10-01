import { defineConfig, devices } from '@playwright/test';

// BASE_URL permet de viser la version en ligne (GitHub Pages) au lieu du build local.
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/soufflet/';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-paysage',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        viewport: { width: 844, height: 390 },
        screen: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: [
    // Mise en relation locale pour les tests du jeu en ligne.
    { command: 'node scripts/peer-server.mjs', url: 'http://127.0.0.1:9000/slap', reuseExistingServer: false, timeout: 30_000 },
    ...(process.env.BASE_URL
      ? []
      : [{ command: 'npm run build && npm run preview', url: BASE_URL, reuseExistingServer: false, timeout: 180_000 }]),
  ],
});
