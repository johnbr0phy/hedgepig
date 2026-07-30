import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev-only: let the page POST a rendered frame to disk, so the meadow can be
 * looked at without a human at the keyboard.  v1 had `smoke.js` for the same
 * reason — you cannot tune a thing you can only see by playing it.
 */
function frameGrabber(outDir) {
  return {
    name: 'frame-grabber',
    apply: 'serve',
    configureServer(server) {
      fs.mkdirSync(outDir, { recursive: true });
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const name = (body.name || 'shot').replace(/[^\w.-]/g, '_');
            const data = String(body.data || '').replace(/^data:image\/\w+;base64,/, '');
            const file = path.join(outDir, name.endsWith('.jpg') ? name : name + '.jpg');
            fs.writeFileSync(file, Buffer.from(data, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file, bytes: data.length }));
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

const SHOT_DIR = path.resolve(process.cwd(), '.shots');

export default defineConfig({
  /* Relative URLs so a build runs from any subdirectory — v1 is served from a
   * GitHub Pages project path and v2 will be served from /v2/ underneath it. */
  base: './',
  plugins: [frameGrabber(SHOT_DIR)],
  server: { port: 5180, host: '127.0.0.1', open: false },
  preview: { port: 5181, host: '127.0.0.1' },
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
