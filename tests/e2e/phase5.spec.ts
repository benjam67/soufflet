import { expect, test, type Page } from '@playwright/test';
import { armFreezeOn, collectErrors, expectNoErrors, Finger, getState, scriptTouches, shootFrozen, SHOTS, swipeSteps } from './helpers';

type St = Awaited<ReturnType<typeof getState>> & {
  scenePhase: string;
  turns: number;
  rage: { left: number; right: number };
  specialReady: { left: boolean; right: boolean };
  stunned: { left: boolean; right: boolean };
  dizzy: { left: boolean; right: boolean };
  last: null | { kind: string; damage: number };
  special: boolean;
  combo: number;
  hint: string;
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

  test('Le Battoir : swipe vers le haut pour le déclencher, jauge lente et zone étroite, un coup énorme', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left', 'banner');
    // (En jeu, la spéciale est prête avant le début du tour ; ici on la prépare pendant le bandeau.)
    await onScene(page, "sc.match.rage.left = 100; sc.match.specialReady.left = true; sc.f.left.bar.setRage(1); sc.showReady('left', true);");
    await waitTurn(page, 'left');
    expect((await state(page)).hint).toContain('GLISSE VERS LE HAUT');
    await armFreezeOn(page, 'true');
    await shootFrozen(page, `${SHOTS}/phase5-pret.png`);
    const finger = await Finger.on(page);
    // Une gifle normale reste possible : tant qu'on ne glisse pas vers le haut, rien n'est déclenché.
    expect((await state(page)).special).toBe(false);
    await armFreezeOn(page, 's.special === true && (window.__spT ??= performance.now()) && performance.now() - window.__spT > 250');
    await finger.down(300, 260);
    await finger.swipe(page, 300, 260, 304, 160, 60, 3);
    await finger.up();
    await shootFrozen(page, `${SHOTS}/phase5-annonce.png`);
    let s = await state(page);
    expect(s.special).toBe(true);
    expect(s.scenePhase).toBe('ready');
    expect(s.hint).toContain('LE BATTOIR');
    // La jauge du Battoir monte plus lentement (×0,8) : 1400 ms / 0,8 = 1750 ms pour 100 %.
    await finger.down(300, 230);
    const t0 = Date.now();
    await page.waitForFunction(() => ((window.__slap?.state as { charge?: number })?.charge ?? 0) >= 60, null, { polling: 'raf' });
    expect(Date.now() - t0).toBeGreaterThan(900);
    await armFreezeOn(page, "fx.frozen === true && s.last && s.last.kind === 'special'");
    await finger.swipe(page, 300, 230, 600, 232, 60, 2);
    await finger.up();
    await shootFrozen(page, `${SHOTS}/phase5-battoir.png`);
    await waitTurn(page, 'right', 'banner');
    s = await state(page);
    expect(s.last!.kind).toBe('special');
    expect(100 - s.hp.right).toBe(s.last!.damage);
    expect(s.rage.left).toBe(0);
    expect(s.specialReady.left).toBe(false);
    await expectNoErrors(errors);
  });

  test('rage pleine mais gifle normale : la spéciale est gardée pour plus tard', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left', 'banner');
    await onScene(page, "sc.match.rage.left = 100; sc.match.specialReady.left = true; sc.f.left.bar.setRage(1); sc.showReady('left', true);");
    await waitTurn(page, 'left');
    const finger = await Finger.on(page);
    await slap(page, finger, 300, 600, 60);
    await waitTurn(page, 'right', 'banner');
    const s = await state(page);
    expect(s.last!.kind).toBe('slap');
    expect(s.specialReady.left).toBe(true);
    expect(s.rage.left).toBe(100);
    await expectNoErrors(errors);
  });

  /**
   * Lola déclenche La Toupie (swipe vers le haut), arme, gifle, puis re-glisse aux instants donnés
   * (ms après le début de son tour ; la première gifle part vers 1070 ms). À appeler pendant le
   * bandeau « À TOI, LOLA ! ». Tout est joué dans la
   * page : le rythme se joue à quelques dixièmes de seconde près.
   */
  async function toupie(page: Page, extra: number[]) {
    await onScene(page, 'sc.match.rage.right = 100; sc.match.specialReady.right = true; sc.f.right.bar.setRage(1);');
    await scriptTouches(page, "s.scenePhase === 'ready' && s.attacker === 'right'", [
      ...swipeSteps(0, 600, 260, 596, 160, 50),
      { at: 300, type: 'down', x: 600, y: 230 },
      ...swipeSteps(1000, 600, 230, 300, 232, 60).slice(1),
      ...extra.flatMap((at) => swipeSteps(at, 600, 230, 480, 232, 50)),
    ]);
  }

  test('La Toupie : trois gifles placées en rythme, trois chiffres, trois traces', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    // Bernard laisse filer son tour (gifle molle), puis Lola lance La Toupie.
    await waitTurn(page, 'right', 'banner');
    const before = await fx(page);
    const hpBefore = (await state(page)).hp.left;
    await armFreezeOn(page, `fx.frozen === true && fx.numbers >= ${before.numbers + 2}`);
    await toupie(page, [1450, 1850]);
    await shootFrozen(page, `${SHOTS}/phase5-toupie.png`);
    await page.waitForFunction(() => (window.__slap!.state as unknown as { turns: number; attacker: string }).turns === 2 && (window.__slap!.state as unknown as { attacker: string }).attacker === 'left', null, { polling: 'raf' });
    const after = await fx(page);
    const s = await state(page);
    expect(after.numbers - before.numbers).toBe(3);
    expect(after.handprints.left - before.handprints.left).toBe(3);
    expect(s.last!.kind).toBe('special');
    expect(hpBefore - s.hp.left).toBe(s.last!.damage);
    expect(s.rage.right).toBe(0);
    await expectNoErrors(errors);
  });

  test('La Toupie : sans re-glisser, une seule gifle part ; trop vite, le rythme est cassé', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    for (const extra of [[], [1110]]) {
      await page.goto('./?mode=match&seed=3');
      await waitTurn(page, 'right', 'banner');
      const before = await fx(page);
      await toupie(page, extra);
      await waitTurn(page, 'left', 'banner');
      expect((await fx(page)).numbers - before.numbers).toBe(1);
      const s = await state(page);
      expect(s.last!.kind).toBe('special');
      expect(s.rage.right).toBe(0);
    }
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
    // (La jauge est une fonction du temps d'appui : on la lit pour chaque centième de seconde,
    // sans dépendre de la vitesse de la machine de test.)
    const samples = await page.evaluate(() => {
      const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as { gesture: { press: { t: number }; charge: (t: number) => number } };
      const out: [number, number][] = [];
      for (let ms = 0; ms < 700; ms += 10) out.push([ms, sc.gesture.charge(sc.gesture.press.t + ms)]);
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
