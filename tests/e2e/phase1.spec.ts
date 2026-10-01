import { expect, test } from '@playwright/test';
import { collectErrors, expectNoErrors, Finger, getState, SHOTS, waitPhase, waitReady } from './helpers';

test.describe('phase 1 · la gifle (entraînement)', () => {
  test('appui maintenu + swipe : les PV de Lola baissent et les poses s’enchaînent', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=training');
    await waitReady(page);

    // Enregistre toutes les poses prises pendant la gifle.
    await page.evaluate(() => {
      const seen: Record<string, string[]> = { left: [], right: [] };
      (window as unknown as { __poses: typeof seen }).__poses = seen;
      setInterval(() => {
        const s = window.__slap?.state as { pose: { left: string; right: string } } | undefined;
        if (!s) return;
        for (const side of ['left', 'right'] as const) {
          const list = seen[side];
          if (list[list.length - 1] !== s.pose[side]) list.push(s.pose[side]);
        }
      }, 5);
    });

    const before = await getState(page);
    expect(before.hp.right).toBe(100);
    expect(before.pose).toEqual({ left: 'idle', right: 'idle' });

    const finger = await Finger.on(page);
    await finger.down(300, 230);
    // Swipe quand la jauge dépasse 55 % (hors zone dorée et loin de la surchauffe).
    await page.waitForFunction(() => ((window.__slap?.state as { charge?: number })?.charge ?? 0) >= 55, null, { polling: 'raf' });
    const charging = await getState(page);
    expect(charging.phase).toBe('charging');
    expect(charging.pose.left).toBe('windup');
    await finger.swipe(page, 300, 230, 560, 236, 110, 3);
    await finger.up();

    // Captures au contact (main sur la joue) puis pendant la réaction.
    await page.waitForFunction(() => (window.__slap?.state as { slaps: number }).slaps === 1, null, { polling: 'raf' });
    await page.screenshot({ path: `${SHOTS}/phase1-impact.png` });
    await page.waitForFunction(() => (window.__slap?.state as { pose: { right: string } }).pose.right === 'hit');
    await page.screenshot({ path: `${SHOTS}/phase1-reaction.png` });

    await waitPhase(page, 'ready');
    const after = await getState(page);
    expect(after.hp.right).toBeLessThan(100);
    expect(after.hp.left).toBe(100);
    expect(after.slaps).toBe(1);
    expect(after.last?.kind).toBe('slap');
    expect(100 - after.hp.right).toBe(after.last!.damage);

    const poses = await page.evaluate(() => (window as unknown as { __poses: Record<string, string[]> }).__poses);
    expect(poses.left).toEqual(['idle', 'windup', 'swing', 'slap', 'idle']);
    expect(poses.right).toEqual(['idle', 'hit', 'idle']);
    await page.screenshot({ path: `${SHOTS}/phase1-apres.png` });
    await expectNoErrors(errors);
  });

  test('gifle parfaite dans la zone dorée : critique ×2', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=training');
    await waitReady(page);
    const finger = await Finger.on(page);
    // Fenêtre dorée de Bernard : 80–90 %, soit 140 ms. Le navigateur de test livre les
    // événements avec du retard : on corrige le point de déclenchement d'un essai à l'autre.
    let trigger = 78;
    let landed = false;
    for (let attempt = 0; attempt < 6 && !landed; attempt++) {
      await finger.down(300, 230);
      await page.waitForFunction((t) => ((window.__slap?.state as { charge?: number })?.charge ?? 0) >= t, trigger, { polling: 'raf' });
      await finger.swipe(page, 300, 230, 600, 230, 60, 2);
      await finger.up();
      await waitPhase(page, 'ready');
      const s = await getState(page);
      if (s.last?.kind !== 'slap') continue;
      const last = s.last as unknown as { critical: boolean; damage: number; factors: { C: number } };
      const C = last.factors.C;
      // Le critique correspond exactement à la zone dorée.
      expect(last.critical, `charge ${C}`).toBe(C >= 80 && C <= 90);
      if (last.critical) {
        landed = true;
        // Minimum d'un critique de Bernard sur Lola : 14 × 0,80 × 0,8 × 1 × 2 × 1,1 ≈ 19,7.
        expect(last.damage).toBeGreaterThanOrEqual(19);
        await page.screenshot({ path: `${SHOTS}/phase1-parfait.png` });
      } else {
        trigger += 85 - C;
      }
    }
    expect(landed, 'aucune gifle dans la zone dorée en 6 essais').toBe(true);
    await expectNoErrors(errors);
  });

  test('capture de l’armement (jauge visible)', async ({ page }) => {
    await page.goto('./?mode=training');
    await waitReady(page);
    const finger = await Finger.on(page);
    await finger.down(300, 230);
    await page.waitForFunction(() => ((window.__slap?.state as { charge?: number })?.charge ?? 0) >= 45, null, { polling: 'raf' });
    await page.screenshot({ path: `${SHOTS}/phase1-armement.png` });
    await finger.up();
  });

  test('surchauffe : Bernard se gifle lui-même (8 dégâts)', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=training');
    await waitReady(page);
    const finger = await Finger.on(page);
    await finger.down(300, 230);
    await page.waitForFunction(() => (window.__slap?.state as { pose: { left: string } }).pose.left === 'selfslap', null, {
      timeout: 4000,
    });
    await page.screenshot({ path: `${SHOTS}/phase1-surchauffe.png` });
    await finger.up();
    await waitPhase(page, 'ready');
    const s = await getState(page);
    expect(s.hp.left).toBe(92);
    expect(s.hp.right).toBe(100);
    expect(s.last?.kind).toBe('selfslap');
    await expectNoErrors(errors);
  });

  test('swipe trop court ou à l’envers : pas de gifle', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=training');
    await waitReady(page);
    const finger = await Finger.on(page);
    await finger.down(400, 230);
    await page.waitForTimeout(500);
    await finger.swipe(page, 400, 230, 430, 230, 60, 3);
    await finger.up();
    await page.waitForTimeout(100);
    await finger.down(400, 230);
    await page.waitForTimeout(500);
    await finger.swipe(page, 400, 230, 200, 230, 80);
    await finger.up();
    await waitPhase(page, 'ready');
    const s = await getState(page);
    expect(s.hp).toEqual({ left: 100, right: 100 });
    expect(s.slaps).toBe(0);
    expect(s.pose.left).toBe('idle');
    await expectNoErrors(errors);
  });
});
