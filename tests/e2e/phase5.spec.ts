import { expect, test, type Page } from '@playwright/test';
import { armFreezeOn, collectErrors, expectNoErrors, Finger, getState, shootFrozen, SHOTS } from './helpers';

type St = Awaited<ReturnType<typeof getState>> & {
  scenePhase: string;
  turns: number;
  rage: { left: number; right: number };
  specialReady: { left: boolean; right: boolean };
  stunned: { left: boolean; right: boolean };
  dizzy: { left: boolean; right: boolean };
  last: null | { kind: string; damage: number };
};
const state = (page: Page) => getState(page) as Promise<St>;
const fx = (page: Page) =>
  page.evaluate(() => (window.__slap as unknown as { fx: { numbers: number; lastKey: string; sounds: string[]; handprints: { left: number; right: number } } }).fx);

/** Accès à la scène et au match (pour préparer une situation de test). */
async function onScene(page: Page, fn: string) {
  await page.evaluate((code) => {
    const sc = window.__slap!.game!.scene.getScene('Fight');
    new Function('sc', code)(sc);
  }, fn);
}

async function waitTurn(page: Page, side: 'left' | 'right', phase = 'ready', timeout = 20_000) {
  await page.waitForFunction(
    ([s, p]) => {
      const st = window.__slap?.state as { scenePhase?: string; attacker?: string } | undefined;
      return st?.scenePhase === p && st.attacker === s;
    },
    [side, phase],
    { timeout, polling: 'raf' },
  );
}

async function slap(page: Page, finger: Finger, from: number, to: number, min = 55) {
  await finger.down(from, 230);
  await page.waitForFunction((m) => ((window.__slap?.state as { charge?: number })?.charge ?? 0) >= m, min, { polling: 'raf' });
  await finger.swipe(page, from, 230, to, 232, 60, 2);
  await finger.up();
}

test.describe('phase 5 · mécaniques avancées', () => {
  test('rage : la jauge monte avec les coups reçus, pleine → « RAGE MAX ! » et spéciale prête', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left');
    await onScene(page, 'sc.match.rage.right = 95; sc.f.right.bar.setRage(0.95);');
    const finger = await Finger.on(page);
    await slap(page, finger, 300, 600);
    await waitTurn(page, 'right', 'banner');
    const s = await state(page);
    expect(s.rage.right).toBe(100);
    expect(s.specialReady.right).toBe(true);
    expect((await fx(page)).sounds).toContain('powerup');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/phase5-rage.png` });
    await expectNoErrors(errors);
  });

  test('Le Battoir : annonce, un coup énorme, la rage retombe à 0', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left', 'banner');
    // (En jeu, la spéciale est prête avant le début du tour ; ici on la prépare pendant le bandeau.)
    await onScene(page, "sc.match.rage.left = 100; sc.match.specialReady.left = true; sc.f.left.bar.setRage(1); sc.showReady('left', true);");
    await waitTurn(page, 'left');
    await armFreezeOn(page, 'true');
    await shootFrozen(page, `${SHOTS}/phase5-pret.png`);
    const finger = await Finger.on(page);
    // Photo pendant l'annonce, puis à l'impact.
    await armFreezeOn(page, "s.scenePhase === 'busy' && (window.__spT ??= performance.now()) && performance.now() - window.__spT > 250");
    await slap(page, finger, 300, 600, 60);
    await shootFrozen(page, `${SHOTS}/phase5-annonce.png`);
    await armFreezeOn(page, "fx.frozen === true && s.last && s.last.kind === 'special'");
    await shootFrozen(page, `${SHOTS}/phase5-battoir.png`);
    await waitTurn(page, 'right', 'banner');
    const s = await state(page);
    expect(s.last!.kind).toBe('special');
    expect(100 - s.hp.right).toBe(s.last!.damage);
    expect(s.rage.left).toBe(0);
    expect(s.specialReady.left).toBe(false);
    expect((await fx(page)).lastKey).toMatch(/^com_(battoir_\d|stun_\d|rage_\d)$/);
    await expectNoErrors(errors);
  });

  test('La Toupie : trois gifles enchaînées, trois chiffres, trois traces', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    // Bernard laisse filer son tour (gifle molle), puis Lola lance La Toupie.
    await waitTurn(page, 'right', 'banner');
    await onScene(page, 'sc.match.rage.right = 100; sc.match.specialReady.right = true; sc.f.right.bar.setRage(1);');
    await waitTurn(page, 'right');
    const before = await fx(page);
    const hpBefore = (await state(page)).hp.left;
    const finger = await Finger.on(page);
    await slap(page, finger, 600, 300, 60);
    await page.waitForFunction((n) => (window.__slap as unknown as { fx: { numbers: number } }).fx.numbers >= n + 2, before.numbers, { timeout: 10_000, polling: 'raf' });
    await armFreezeOn(page, 'fx.frozen === true');
    await shootFrozen(page, `${SHOTS}/phase5-toupie.png`);
    await waitTurn(page, 'left', 'banner');
    const after = await fx(page);
    const s = await state(page);
    expect(after.numbers - before.numbers).toBe(3);
    expect(after.handprints.left - before.handprints.left).toBe(3);
    expect(s.last!.kind).toBe('special');
    expect(hpBefore - s.hp.left).toBe(s.last!.damage);
    expect(s.rage.right).toBe(0);
    await expectNoErrors(errors);
  });

  test('sonné : étoiles au-dessus de la tête et jauge qui monte de façon irrégulière', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'right', 'banner');
    await onScene(page, "sc.match.stunned.right = true; sc.afterHitStatus([{ type: 'stunned', side: 'right' }]);");
    await waitTurn(page, 'right');
    let s = await state(page);
    expect(s.dizzy.right).toBe(true);
    await page.waitForTimeout(300);
    await armFreezeOn(page, 'true');
    await shootFrozen(page, `${SHOTS}/phase5-sonne.png`);
    // On mesure la vitesse de la jauge pendant l'appui : elle doit varier.
    const finger = await Finger.on(page);
    await finger.down(600, 230);
    const samples = await page.evaluate(async () => {
      const out: [number, number][] = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 700) {
        await new Promise((r) => requestAnimationFrame(r));
        const st = window.__slap!.state as { charge: number; phase: string };
        if (st.phase !== 'charging') break;
        out.push([performance.now() - t0, st.charge]);
      }
      return out;
    });
    await finger.up();
    // Toujours en train d'armer pendant toute la mesure : la jauge ne redescend jamais.
    for (let i = 1; i < samples.length; i++) expect(samples[i][1]).toBeGreaterThanOrEqual(samples[i - 1][1]);
    // Vitesse moyenne (en % par ms) sur des tranches de ~120 ms.
    const rates: number[] = [];
    for (let i = 0, j = 0; i < samples.length; i = j) {
      while (j < samples.length && samples[j][0] - samples[i][0] < 120) j++;
      if (j < samples.length && samples[j][1] < 99) rates.push((samples[j][1] - samples[i][1]) / (samples[j][0] - samples[i][0]));
    }
    const nominal = 100 / 1000; // Lola : 100 % en 1000 ms
    const spread = (Math.max(...rates) - Math.min(...rates)) / nominal;
    console.log(`vitesses relatives : ${rates.map((r) => (r / nominal).toFixed(2)).join(' ')}`);
    expect(rates.length).toBeGreaterThanOrEqual(3);
    for (const r of rates) expect(r).toBeGreaterThan(0);
    expect(spread).toBeGreaterThan(0.08);
    // Le tour joué, l'état sonné disparaît.
    await waitTurn(page, 'left', 'banner', 15_000);
    s = await state(page);
    expect(s.stunned.right).toBe(false);
    expect(s.dizzy.right).toBe(false);
    await expectNoErrors(errors);
  });
});
