import { expect, test, type Page } from '@playwright/test';
import { collectErrors, expectNoErrors, Finger, getState, SHOTS } from './helpers';

type State = Awaited<ReturnType<typeof getState>> & {
  scenePhase: string;
  level: string | null;
  control: { left: string; right: string };
  round: number;
  wins: { left: number; right: number };
  winner: 'left' | 'right' | null;
  turns: number;
};
const state = (page: Page) => getState(page) as Promise<State>;

async function waitTurn(page: Page, side: 'left' | 'right', timeout = 20_000) {
  await page.waitForFunction(
    (s) => {
      const st = window.__slap?.state as { phase?: string; attacker?: string } | undefined;
      return st?.phase === 'ready' && st.attacker === s;
    },
    side,
    { timeout, polling: 'raf' },
  );
}

test.describe('phase 4 · mode solo', () => {
  test('le joueur gifle, puis l’IA répond seule ; les touchers pendant son tour sont ignorés', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=solo&level=hard&seed=4');
    await page.waitForFunction(() => window.__slap?.ready === true);
    await waitTurn(page, 'left');
    let s = await state(page);
    expect(s.level).toBe('hard');
    expect(s.control).toEqual({ left: 'human', right: 'ai' });

    const finger = await Finger.on(page);
    await finger.down(300, 230);
    await page.waitForFunction(() => ((window.__slap?.state as { charge?: number })?.charge ?? 0) >= 55, null, { polling: 'raf' });
    await finger.swipe(page, 300, 230, 600, 232, 80, 3);
    await finger.up();

    // Tour de l'IA : on tape partout, rien ne doit se passer côté joueur.
    await page.waitForFunction(() => (window.__slap?.state as { attacker?: string })?.attacker === 'right', null, { timeout: 10_000 });
    for (let i = 0; i < 3; i++) {
      await finger.down(500, 200);
      await page.waitForTimeout(120);
      await finger.up();
    }
    await page.waitForFunction(() => (window.__slap?.state as { phase?: string })?.phase === 'charging', null, { timeout: 10_000, polling: 'raf' });
    s = await state(page);
    expect(s.attacker).toBe('right');
    expect(s.pose.right).toBe('windup');
    expect(s.pose.left).toBe('idle');

    // L'IA frappe (une vraie gifle, pas une gifle molle), puis la main revient au joueur.
    const t0 = s.turns;
    await page.waitForFunction(
      (t) => {
        const st = window.__slap?.state as { turns: number; attacker: string; phase: string; last: { kind?: string } | null };
        return st.turns > t && st.attacker === 'left' && st.phase === 'ready';
      },
      t0,
      { timeout: 15_000, polling: 'raf' },
    );
    s = await state(page);
    expect(s.last?.kind).toBe('slap');
    expect(s.hp.left).toBeLessThan(100);
    await expectNoErrors(errors);
  });

  test('match complet perdu contre l’IA difficile : écran « DÉFAITE… »', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    // Le joueur ne touche à rien : ses tours partent en gifle molle, l'IA gagne.
    await page.goto('./?mode=solo&level=hard&speed=8&seed=9');
    await page.waitForFunction(() => window.__slap?.ready === true);
    await page.waitForFunction(() => (window.__slap?.state as { scenePhase?: string })?.scenePhase === 'over', null, { timeout: 160_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/phase4-defaite.png` });
    const s = await state(page);
    expect(s.winner).toBe('right');
    expect(s.wins.right).toBe(2);
    const texts = await page.evaluate(() => {
      type O = { type: string; text?: string; name?: string; list?: O[] };
      const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as { children: { list: O[] } };
      const out: string[] = [];
      const walk = (l: O[]) => l.forEach((o) => (o.text && out.push(o.text), o.name && out.push(o.name), o.list && walk(o.list)));
      walk(sc.children.list);
      return out;
    });
    expect(texts).toContain('DÉFAITE…');
    expect(texts).toContain('btn-REVANCHE');
    expect(texts).not.toContain('btn-NIVEAU SUIVANT');
    await expectNoErrors(errors);
  });

  test('les trois niveaux se lancent depuis l’URL', async ({ page }) => {
    const errors = collectErrors(page);
    for (const level of ['easy', 'normal', 'hard']) {
      await page.goto(`./?mode=solo&level=${level}`);
      await page.waitForFunction(() => window.__slap?.ready === true);
      const s = await state(page);
      expect(s.mode).toBe('solo');
      expect(s.level).toBe(level);
    }
    await expectNoErrors(errors);
  });
});
