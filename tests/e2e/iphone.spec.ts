import { expect, test } from '@playwright/test';
import { collectErrors, expectNoErrors, SHOTS, waitReady } from './helpers';

test.describe('iPhone : encoche, barre d’accueil, plein écran', () => {
  test('l’interface reste dans la zone sûre (marges simulées : 47 px sur les côtés, 21 px en bas)', async ({ page }) => {
    const errors = collectErrors(page);
    const xs = () =>
      page.evaluate(() => {
        const g = window.__slap!.game!;
        const sc = g.scene.getScene('Fight') as unknown as { homeBtn: { x: number }; soundBtn: { x: number }; hint: { y: number }; scale: { width: number; height: number } };
        const k = g.scale.displayScale.x;
        return { home: sc.homeBtn.x / k, sound: (sc.scale.width - sc.soundBtn.x) / k, hintFromBottom: (sc.scale.height - sc.hint.y) / g.scale.displayScale.y };
      });
    await page.goto('./?mode=training');
    await waitReady(page);
    const plain = await xs();
    await page.goto('./?mode=training&safe=47,47,0,21');
    await waitReady(page);
    const safe = await xs();
    expect(safe.home - plain.home).toBeCloseTo(47, 0);
    expect(safe.sound - plain.sound).toBeCloseTo(47, 0);
    expect(safe.hintFromBottom - plain.hintFromBottom).toBeCloseTo(21, 0);
    await page.screenshot({ path: `${SHOTS}/iphone-zone-sure.png` });
    await expectNoErrors(errors);
  });

  test('dans Safari sur iPhone, l’accueil explique comment avoir le plein écran', async ({ page }) => {
    const errors = collectErrors(page);
    const footer = () =>
      page.evaluate(() => {
        type O = { text?: string; list?: O[] };
        const sc = window.__slap!.game!.scene.getScene('Title') as unknown as { children: { list: O[] } };
        return sc.children.list.map((o) => o.text ?? '').filter(Boolean);
      });
    await page.goto('./?ios=1&safe=47,47,0,21');
    await page.waitForFunction(() => window.__slap?.scene === 'Title');
    expect((await footer()).join('|')).toContain('Sur l’écran d’accueil');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/iphone-accueil.png` });
    await expectNoErrors(errors);
  });
});
