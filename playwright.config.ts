import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1280, height: 720 },
    browserName: 'firefox',
    launchOptions: {
      env: process.env as Record<string, string>,
      firefoxUserPrefs: { 'webgl.force-enabled': true, 'security.sandbox.content.level': 0, 'dom.disable_beforeunload': true, 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 },
    },
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
