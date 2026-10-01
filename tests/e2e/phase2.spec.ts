import { expect, test, type Page } from '@playwright/test';
import { collectErrors, expectNoErrors, Finger, getState, SHOTS } from './helpers';

type State = Awaited<ReturnType<typeof getState>> & {
  scenePhase: string;
  round: number;
  wins: { left: number; right: number };
  winner: 'left' | 'right' | null;
  turns: number;
  last: null | { kind: string; damage: number };
};
const state = (page: Page) => getState(page) as Promise<State>;

/** Attend que ce soit au tour de `side` et que la main soit au joueur. */
async function waitTurn(page: Page, side: 'left' | 'right', timeout = 15_000) {
  await page.waitForFunction(
    (s) => {
      const st = window.__slap?.state as { phase?: string; attacker?: string } | undefined;
      return st?.phase === 'ready' && st.attacker === s;
    },
    side,
    { timeout, polling: 'raf' },
  );
}

async function slap(page: Page, finger: Finger, fromX: number, toX: number) {
  await finger.down(fromX, 230);
  await page.waitForFunction(() => ((window.__slap?.state as { charge?: number })?.charge ?? 0) >= 50, null, { polling: 'raf' });
  await finger.swipe(page, fromX, 230, toX, 234, 100, 3);
  await finger.up();
}

test.describe('phase 2 · le match', () => {
  test('match à deux : Bernard gifle, bandeau « À TOI, LOLA ! », Lola gifle en retour', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await page.waitForFunction(() => window.__slap?.ready === true);
    // Annonce du round 1
    await page.waitForFunction(() => (window.__slap?.state as { scenePhase?: string })?.scenePhase === 'intro');
    await page.screenshot({ path: `${SHOTS}/phase2-round1.png` });
    await waitTurn(page, 'left');
    let s = await state(page);
    expect(s.round).toBe(1);
    expect(s.hp).toEqual({ left: 100, right: 100 });

    const finger = await Finger.on(page);
    await slap(page, finger, 300, 560);
    // Bandeau du tour suivant
    await page.waitForFunction(
      () => {
        const st = window.__slap?.state as { scenePhase?: string; attacker?: string };
        return st.scenePhase === 'banner' && st.attacker === 'right';
      },
      null,
      { timeout: 10_000, polling: 'raf' },
    );
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/phase2-bandeau.png` });
    s = await state(page);
    expect(s.hp.right).toBeLessThan(100);
    const lolaHp = s.hp.right;

    await waitTurn(page, 'right');
    // Lola est à droite : elle gifle vers la gauche.
    await slap(page, finger, 600, 340);
    await waitTurn(page, 'left');
    s = await state(page);
    expect(s.hp.left).toBeLessThan(100);
    expect(s.hp.right).toBe(lolaHp);
    expect(s.turns).toBe(2);
    await expectNoErrors(errors);
  });

  test('chrono de 3 s dépassé : gifle molle automatique de 5 dégâts', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await waitTurn(page, 'left');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/phase2-chrono.png` });
    await waitTurn(page, 'right', 10_000);
    const s = await state(page);
    expect(s.last).toEqual({ kind: 'limp', damage: 5 });
    expect(s.hp).toEqual({ left: 100, right: 95 });
    await expectNoErrors(errors);
  });

  test('démo IA contre IA : match complet jusqu’à l’écran de victoire, puis revanche', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await page.goto('./?autoplay=1&speed=6&seed=3');
    await page.waitForFunction(() => window.__slap?.ready === true);
    await page.waitForFunction(() => (window.__slap?.state as { scenePhase?: string })?.scenePhase === 'roundEnd', null, {
      timeout: 120_000,
      polling: 'raf',
    });
    await page.screenshot({ path: `${SHOTS}/phase2-ko.png` });
    await page.waitForFunction(() => (window.__slap?.state as { scenePhase?: string })?.scenePhase === 'over', null, {
      timeout: 150_000,
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/phase2-victoire.png` });
    const s = await state(page);
    expect(s.winner).not.toBeNull();
    expect(s.wins[s.winner!]).toBe(2);
    expect(s.round).toBeGreaterThanOrEqual(2);
    expect(s.pose[s.winner!]).toBe('victory');

    // Bouton REVANCHE : relance un match au round 1.
    const pos = await page.evaluate(() => {
      const g = window.__slap!.game!;
      type Obj = { name: string; x: number; y: number; list?: Obj[] };
      const scene = g.scene.getScene('Fight') as unknown as { children: { list: Obj[] } };
      const find = (list: Obj[], ox = 0, oy = 0): { x: number; y: number } | null => {
        for (const o of list) {
          if (o.name === 'btn-REVANCHE') return { x: ox + o.x, y: oy + o.y };
          const inner = o.list && find(o.list, ox + o.x, oy + o.y);
          if (inner) return inner;
        }
        return null;
      };
      const b = find(scene.children.list)!;
      return { x: b.x / g.scale.displayScale.x, y: b.y / g.scale.displayScale.y };
    });
    const finger = await Finger.on(page);
    await finger.down(pos.x, pos.y);
    await finger.up();
    await page.waitForFunction(() => (window.__slap?.state as { round?: number; scenePhase?: string })?.round === 1, null, { timeout: 10_000 });
    const again = await state(page);
    expect(again.wins).toEqual({ left: 0, right: 0 });
    await expectNoErrors(errors);
  });
});
