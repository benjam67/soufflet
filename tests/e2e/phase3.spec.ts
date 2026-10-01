import { expect, test, type Page } from '@playwright/test';
import { armFreezeOn, collectErrors, expectNoErrors, Finger, getState, shootFrozen, SHOTS, waitPhase, waitReady } from './helpers';

interface FxState {
  flashes: number;
  focusLines: number;
  onomatopoeia: number;
  particles: number;
  numbers: number;
  screenFlashes: number;
  cheers: number;
  boos: number;
  whistles: number;
  comments: number;
  lastKey: string;
  handprints: { left: number; right: number };
  sounds: string[];
  frozen: boolean;
  timeScale: number;
}
const fx = (page: Page) => page.evaluate(() => (window.__slap as unknown as { fx: FxState }).fx);

async function slap(page: Page, finger: Finger, minCharge = 55, from = 300, to = 600) {
  await finger.down(from, 230);
  await page.waitForFunction((m) => ((window.__slap?.state as { charge?: number })?.charge ?? 0) >= m, minCharge, { polling: 'raf' });
  await finger.swipe(page, from, 230, to, 232, 60, 2);
  await finger.up();
}

test.describe('phase 3 · le spectacle', () => {
  test('impact : éclair, lignes de focus, onomatopée, son, foule et commentateur', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=training');
    await waitReady(page);
    const finger = await Finger.on(page);
    await armFreezeOn(page, 'fx.frozen === true');
    await slap(page, finger);
    await shootFrozen(page, `${SHOTS}/phase3-impact.png`);
    // Juste après l'arrêt sur image : réaction, foule, commentateur.
    await page.waitForFunction(() => (window.__slap as unknown as { fx: FxState }).fx.comments >= 1, null, { timeout: 5000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/phase3-reaction.png` });
    await waitPhase(page, 'ready');
    const f = await fx(page);
    expect(f.flashes).toBe(1);
    expect(f.focusLines).toBe(1);
    expect(f.onomatopoeia).toBe(1);
    expect(f.numbers).toBe(1);
    expect(f.handprints.right).toBe(1);
    expect(f.cheers + f.boos).toBeGreaterThanOrEqual(1);
    expect(f.comments).toBe(1);
    expect(f.lastKey).toMatch(/^com_(normal|big|crit|grazed|missed)_\d$/);
    // Le geste de l'utilisateur a débloqué l'audio : musique, souffle, claque, cri, foule.
    for (const s of ['music', 'whoosh', 'slap', 'cry-lola', 'crowd']) {
      expect(f.sounds.some((x) => x.startsWith(s)), s).toBe(true);
    }
    await expectNoErrors(errors);
  });

  test('gros coup : critique, flash, ralenti, gouttes et dents qui volent', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=training');
    await waitReady(page);
    const finger = await Finger.on(page);
    // Il faut viser la zone dorée : l'essai se corrige d'une fois sur l'autre.
    let trigger = 78;
    let shot = false;
    for (let i = 0; i < 6 && !shot; i++) {
      await armFreezeOn(page, 'fx.particles >= 1 && fx.timeScale < 1');
      await slap(page, finger, trigger);
      await waitPhase(page, 'ready', 15_000).catch(() => undefined);
      const s = await getState(page);
      const last = s.last as unknown as { critical?: boolean; factors?: { C: number } } | null;
      const froze = await page.evaluate(() => (window as unknown as { __froze?: boolean }).__froze === true);
      if (froze) {
        await shootFrozen(page, `${SHOTS}/phase3-critique.png`);
        await waitPhase(page, 'ready');
        shot = !!last?.critical || shot;
      }
      if (!last?.critical && last?.factors) trigger += 85 - last.factors.C;
      await page.evaluate(() => (window.__slap as unknown as { game: { loop: { wake: () => void } } }).game.loop.wake());
    }
    const f = await fx(page);
    expect(f.particles).toBeGreaterThanOrEqual(1);
    expect(f.screenFlashes).toBeGreaterThanOrEqual(1);
    expect(f.sounds).toContain('slap-crit');
    await expectNoErrors(errors);
  });

  test('traces de main : elles s’accumulent sur la joue au fil des gifles', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=training');
    await waitReady(page);
    const finger = await Finger.on(page);
    for (let i = 0; i < 4; i++) {
      await slap(page, finger, 40 + i * 5);
      await waitPhase(page, 'ready');
    }
    const f = await fx(page);
    expect(f.handprints.right).toBe(4);
    const s = await getState(page);
    expect(s.pose.right).toBe('idle');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/phase3-traces.png`, clip: { x: 470, y: 60, width: 260, height: 160 } });
    await expectNoErrors(errors);
  });

  test('début de match : le patron siffle, la foule s’anime', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=match');
    await page.waitForFunction(() => window.__slap?.ready === true);
    await armFreezeOn(page, 'fx.whistles >= 1 && (window.__wT ??= performance.now()) && performance.now() - window.__wT > 220');
    await shootFrozen(page, `${SHOTS}/phase3-sifflet.png`);
    const f = await fx(page);
    expect(f.whistles).toBe(1);
    expect(f.comments).toBe(1); // « Mesdames, messieurs, ça va claquer ! » & co
    // Les habitués bougent : leurs positions changent d'une image à l'autre.
    const ys = async () =>
      page.evaluate(() => {
        const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as { children: { list: { texture?: { key: string }; y: number }[] } };
        return sc.children.list.filter((o) => o.texture?.key.startsWith('habitue_')).map((o) => Math.round(o.y * 10));
      });
    const a = await ys();
    await page.waitForTimeout(400);
    const b = await ys();
    expect(a).toHaveLength(8);
    expect(a).not.toEqual(b);
    await expectNoErrors(errors);
  });

  test('K.O. : annonce, flash et foule en délire (démo IA accélérée)', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await page.goto('./?autoplay=1&speed=4&seed=11');
    await page.waitForFunction(() => window.__slap?.ready === true);
    // Photo 120 ms (réelles) après le K.O. : l'annonce est grande, la foule saute.
    await armFreezeOn(
      page,
      "s.scenePhase === 'roundEnd' && (window.__koT ??= performance.now()) && performance.now() - window.__koT > 120",
    );
    await page.waitForFunction(() => (window as unknown as { __froze?: boolean }).__froze === true, null, { timeout: 120_000 });
    await page.screenshot({ path: `${SHOTS}/phase3-ko.png` });
    await page.evaluate(() => (window.__slap as unknown as { game: { loop: { wake: () => void } } }).game.loop.wake());
    const f = await fx(page);
    expect(f.comments).toBeGreaterThanOrEqual(1);
    expect(f.lastKey).toMatch(/^com_ko_\d$/);
    await expectNoErrors(errors);
  });

  test('bouton son : coupe le son et s’en souvient au rechargement', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=training');
    await waitReady(page);
    const pos = await page.evaluate(() => {
      const g = window.__slap!.game!;
      const sc = g.scene.getScene('Fight') as unknown as { children: { list: { texture?: { key: string }; x: number; y: number }[] } };
      const b = sc.children.list.find((o) => o.texture?.key.startsWith('ico_sound'))!;
      return { x: b.x / g.scale.displayScale.x, y: b.y / g.scale.displayScale.y, key: b.texture!.key };
    });
    expect(pos.key).toBe('ico_sound_on');
    const finger = await Finger.on(page);
    await finger.down(pos.x, pos.y);
    await finger.up();
    await page.waitForTimeout(200);
    // Toucher le bouton ne doit pas lancer une gifle.
    const s = await getState(page);
    expect(s.phase).toBe('ready');
    expect(await page.evaluate(() => localStorage.getItem('slap.muted'))).toBe('1');
    await page.reload();
    await waitReady(page);
    const key = await page.evaluate(() => {
      const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as { children: { list: { texture?: { key: string } }[] } };
      return sc.children.list.find((o) => o.texture?.key.startsWith('ico_sound'))!.texture!.key;
    });
    expect(key).toBe('ico_sound_off');
    await expectNoErrors(errors);
  });

  test('chargement initial < 3 Mo', async ({ page }) => {
    await page.goto('./?mode=match');
    await waitReady(page);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')] as PerformanceResourceTiming[];
      const own = entries.filter((e) => !e.name.includes('fonts.g'));
      return {
        files: own.length,
        decoded: own.reduce((n, e) => n + (e.decodedBodySize || 0), 0),
        transferred: own.reduce((n, e) => n + (e.transferSize || 0), 0),
      };
    });
    console.log(`chargement : ${r.files} fichiers, ${(r.decoded / 1024 / 1024).toFixed(2)} Mo décodés, ${(r.transferred / 1024 / 1024).toFixed(2)} Mo transférés`);
    expect(r.files).toBeGreaterThan(25);
    expect(r.decoded).toBeLessThan(3 * 1024 * 1024);
  });

  test('performance : logique + effets < 8 ms par image avec processeur ralenti ×4', async ({ page }) => {
    test.setTimeout(120_000);
    const cdp = await page.context().newCDPSession(page);
    await page.goto('./?autoplay=1&seed=5&speed=2');
    await page.waitForFunction(() => window.__slap?.ready === true);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const r = await page.evaluate(async () => {
      type G = { loop: { callback: (t: number, d: number) => void }; renderer: { render: (...a: unknown[]) => void } };
      const g = (window.__slap as unknown as { game: G }).game;
      const total: number[] = [];
      const render: number[] = [];
      const origLoop = g.loop.callback;
      const origRender = g.renderer.render.bind(g.renderer);
      let rt = 0;
      g.renderer.render = (...a: unknown[]) => {
        const s = performance.now();
        origRender(...a);
        rt += performance.now() - s;
      };
      g.loop.callback = (t, d) => {
        rt = 0;
        const s = performance.now();
        origLoop(t, d);
        total.push(performance.now() - s - rt);
        render.push(rt);
      };
      await new Promise((res) => setTimeout(res, 20_000));
      g.loop.callback = origLoop;
      g.renderer.render = origRender;
      const q = (arr: number[], p: number) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
      return {
        frames: total.length,
        logic: { median: q(total, 0.5), p95: q(total, 0.95), p99: q(total, 0.99), max: Math.max(...total) },
        render: { median: q(render, 0.5), p95: q(render, 0.95) },
      };
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log(
      `CPU ×4 · logique+effets : médiane ${r.logic.median.toFixed(2)} ms, p95 ${r.logic.p95.toFixed(2)} ms, p99 ${r.logic.p99.toFixed(2)} ms, max ${r.logic.max.toFixed(1)} ms` +
        ` · envoi du rendu (WebGL logiciel, sans GPU) : médiane ${r.render.median.toFixed(2)} ms, p95 ${r.render.p95.toFixed(2)} ms · ${r.frames} images`,
    );
    // Budget d'une image à 60 fps : 16,7 ms. Sur un téléphone, le rendu passe par le GPU ;
    // ici il est rastérisé en logiciel (aucun GPU dans le bac à sable) et n'est pas représentatif.
    // On garantit donc que le travail du jeu lui-même laisse au moins la moitié du budget au rendu.
    expect(r.logic.p95).toBeLessThan(8);
    // p99 = la 2e pire image sur ~170 : bruité, on le borne au budget entier d'une image.
    expect(r.logic.p99).toBeLessThan(16.7);
  });
});
