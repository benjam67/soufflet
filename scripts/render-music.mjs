// Rend la musique du jeu en WAV (npm run music -- sortie.wav) pour l’écouter hors du jeu.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const srv = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const b = await chromium.launch();
const page = await b.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5199/soufflet/scripts/render-music.html');
await page.waitForFunction(() => window.ready);
const r = await page.evaluate(() => window.render());
fs.writeFileSync(process.argv[2], Buffer.from(r.wav, 'base64'));
console.log(JSON.stringify({ seconds: r.seconds.toFixed(1), peak: r.peak.toFixed(3), rmsDb: r.rmsDb.toFixed(1), nan: r.nan }));
await b.close(); srv.kill();
