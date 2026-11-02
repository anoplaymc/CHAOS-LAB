#!/usr/bin/env node
// The mod toolkit's command line. Runs the game's real loader through Vite, with no browser.
// Usage: npm run mod -- <new|validate|test|pack|docs|list> [args]
import { createServer } from 'vite';

const server = await createServer({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
});
let code = 1;
try {
  const { main } = await server.ssrLoadModule('/src/modding/cli.ts');
  code = await main(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
} finally {
  await server.close();
}
process.exit(code);
