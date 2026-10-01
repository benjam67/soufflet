import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    // Les polices Google peuvent être bloquées par le réseau de test : pas une erreur du jeu.
    if (m.type() === 'error' && !m.location().url.includes('fonts.g')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => {
    // Les polices Google peuvent être bloquées hors ligne : pas une erreur du jeu.
    if (!r.url().includes('fonts.g')) errors.push(`requête échouée : ${r.url()}`);
  });
  return errors;
}

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__slap?.ready === true, null, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

test('la scène de combat s’affiche sans erreur en paysage', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./?mode=match');
  await waitReady(page);

  const info = await page.evaluate(() => {
    const g = window.__slap!.game!;
    const scene = g.scene.getScene('Fight') as unknown as {
      children: { list: { type: string; texture?: { key: string }; flipX?: boolean; visible: boolean }[] };
    };
    return {
      size: [g.scale.width, g.scale.height],
      textures: scene.children.list.filter((o) => o.texture).map((o) => ({ key: o.texture!.key, flipX: o.flipX })),
      layout: window.__slap!.layout as {
        left: { left: number; right: number; top: number };
        right: { left: number; right: number; top: number };
      },
    };
  });

  const keys = info.textures.map((t) => t.key);
  expect(keys).toContain('decor');
  expect(keys).toContain('patron');
  expect(keys.filter((k) => k.startsWith('habitue_'))).toHaveLength(8);
  expect(info.textures.find((t) => t.key === 'bernard_idle')?.flipX).toBe(false);
  expect(info.textures.find((t) => t.key === 'lola_idle')?.flipX).toBe(true);
  // Combattants visibles en entier dans le monde du jeu.
  const [w] = info.size;
  expect(info.layout.left.left).toBeGreaterThanOrEqual(0);
  expect(info.layout.right.right).toBeLessThanOrEqual(w);

  await page.screenshot({ path: `${SHOTS}/phase0-scene.png` });
  expect(errors).toEqual([]);
});

test('écran « tourne ton téléphone » en portrait', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?mode=match');
  await expect(page.locator('#rotate')).toBeVisible();
  await expect(page.locator('#rotate')).toContainText('Tourne ton téléphone');
  await page.screenshot({ path: `${SHOTS}/phase0-portrait.png` });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#rotate')).toBeHidden();
  expect(errors).toEqual([]);
});

test('manifest PWA valide', async ({ page, request }) => {
  await page.goto('./?mode=match');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await request.get(new URL(href!, page.url()).toString());
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('fullscreen');
  expect(m.orientation).toBe('landscape');
  for (const icon of m.icons) {
    const r = await request.get(new URL(icon.src, page.url()).toString());
    expect(r.ok(), icon.src).toBe(true);
  }
});
