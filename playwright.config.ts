// Browser tests against a server on the test database (reset first). Chromium is the one installed
// with Playwright, or PW_CHANNEL=chrome on a Mac.
import { defineConfig } from '@playwright/test';
import { loadDotEnv } from './src/server/config.ts';

const env = { ...loadDotEnv(), ...process.env } as Record<string, string>;
const testDb = env['TEST_DATABASE_URL'];
if (!testDb) throw new Error('TEST_DATABASE_URL is not set (see .env.example).');

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3299', viewport: { width: 1440, height: 900 }, ...(env['PW_CHANNEL'] ? { channel: env['PW_CHANNEL'] } : {}) },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning tests/browser/reset.ts && node --disable-warning=ExperimentalWarning src/server/main.ts',
    url: 'http://127.0.0.1:3299/api/health',
    reuseExistingServer: false,
    env: { DATABASE_URL: testDb, PORT: '3299', HOST: '127.0.0.1', STORAGE_DIR: 'test-results/storage' },
  },
});
