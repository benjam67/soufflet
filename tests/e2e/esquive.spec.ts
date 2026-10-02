import { expect, test, type Page } from '@playwright/test';
import { armFreezeOn, collectErrors, dodgeOnTravel, expectNoErrors, getState, scriptTouches, shootFrozen, SHOTS, swipeSteps, type TouchStep } from './helpers';

type St = Awaited<ReturnType<typeof getState>> & {
  scenePhase: string;
  rage: { left: number; right: number };
  specialReady: { left: boolean; right: boolean };
  stunned: { left: boolean; right: boolean };
  wins: { left: number; right: number };
  round: number;
  lastWord: string | null;
  opener: string | null;
  hint: string;
  defMove: string | null;
  last: null | { kind: string; damage: number; dodge?: string | null; avoided?: number; critical?: boolean };
};
const state = (page: Page) => getState(page) as Promise<St>;
const fx = (page: Page) => page.evaluate(() => (window.__slap as unknown as { fx: { lastKey: string; sounds: string[] } }).fx);

async function onScene(page: Page, code: string) {
  await page.evaluate((c) => new Function('sc', c)(window.__slap!.game!.scene.getScene('Fight')), code);
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

/** Journal des phases de la scène, daté (ms), tenu dans la page. */
async function logPhases(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __phases: [number, string][] };
    w.__phases = [];
    let last = '';
    setInterval(() => {
      const p = (window.__slap?.state as { scenePhase?: string } | undefined)?.scenePhase ?? '';
      if (p !== last) w.__phases.push([performance.now(), (last = p)]);
    }, 1);
  });
}
const phases = (page: Page) => page.evaluate(() => (window as unknown as { __phases: [number, string][] }).__phases);

const READY_LEFT = "s.scenePhase === 'ready' && s.attacker === 'left'";
/** Bernard (doigt 1, moitié gauche) : appui, 800 ms d'armement (~57 %), swipe vers Lola. La gifle part vers 870 ms. */
const bernardSlap = (lift = true): TouchStep[] => [{ at: 0, type: 'down', x: 300, y: 230 }, ...swipeSteps(800, 300, 230, 520, 232, 60, 1, lift).slice(1)];
/** Lola (doigt 2, moitié droite) glisse vers l'arrière (vers la droite). */
const lolaBack = (at: number) => swipeSteps(at, 620, 250, 700, 252, 30, 2);
/** Lola glisse vers le bas : garde de rage. */
const lolaDown = (at: number) => swipeSteps(at, 620, 200, 622, 280, 30, 2);

test.describe('esquive, feinte, garde de rage, droit de réponse', () => {
  test('esquive : swipe arrière juste avant l’impact, dégâts réduits, perso teinté', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left');
    expect((await state(page)).hint).toContain('ESQUIVE');
    await armFreezeOn(page, 'fx.frozen === false && s.last && s.last.dodge && (window.__dT ??= performance.now()) && performance.now() - window.__dT > 60');
    // La gifle met 360 ms à arriver : Lola recule quand elle en est aux deux tiers du trajet.
    await dodgeOnTravel(page, { side: 'left', afterMs: 230, from: [620, 250], to: [700, 252], id: 2 });
    await scriptTouches(page, READY_LEFT, bernardSlap());
    await shootFrozen(page, `${SHOTS}/esquive-impact.png`);
    await waitTurn(page, 'right', 'banner');
    const s = await state(page);
    expect(['good', 'perfect']).toContain(s.last!.dodge);
    expect(s.last!.avoided).toBeGreaterThan(0);
    expect(100 - s.hp.right).toBe(s.last!.damage);
    expect(s.defMove).toBeNull(); // nouveau tour : nouvel essai
    console.log(`esquive : ${s.last!.dodge}, ${s.last!.damage} dégâts au lieu de ${s.last!.damage + s.last!.avoided!}`);
    await expectNoErrors(errors);
  });

  test('esquive trop tôt : aucune réduction, aucune pénalité, et pas de deuxième essai', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left', 'banner');
    // Lola recule pendant que Bernard arme (bien trop tôt), puis réessaie au bon moment : ignoré.
    await dodgeOnTravel(page, { side: 'left', afterMs: 230, from: [620, 250], to: [700, 252], id: 2 });
    await scriptTouches(page, READY_LEFT, [...bernardSlap(), ...lolaBack(300)]);
    await waitTurn(page, 'right', 'banner');
    const s = await state(page);
    expect(s.last!.kind).toBe('slap');
    expect(s.last!.dodge).toBeNull();
    expect(s.last!.avoided).toBe(0);
    // Mêmes dégâts qu'une gifle reçue sans bouger (57 % de charge, non critique).
    expect(s.last!.damage).toBeGreaterThanOrEqual(8);
    expect(100 - s.hp.right).toBe(s.last!.damage);
    await expectNoErrors(errors);
  });

  test('feinte : la gifle est retenue tant que le doigt reste posé, puis part au lever', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left', 'banner');
    await logPhases(page);
    await armFreezeOn(page, "s.scenePhase === 'armed' && (window.__aT ??= performance.now()) && performance.now() - window.__aT > 200");
    void shootFrozen(page, `${SHOTS}/esquive-feinte.png`);
    await scriptTouches(page, READY_LEFT, [...bernardSlap(false), { at: 1400, type: 'up', x: 520, y: 232 }]);
    await waitTurn(page, 'right', 'banner');
    const log = await phases(page);
    const at = (p: string) => log.find(([, name]) => name === p)?.[0] ?? NaN;
    expect(log.map(([, p]) => p).join(' ')).toContain('charging armed travel');
    // Armée vers 860 ms, lâchée à 1400 ms (le chrono du tour est arrêté pendant la feinte).
    expect(at('travel') - at('armed')).toBeGreaterThan(300);
    const s = await state(page);
    expect(s.last!.kind).toBe('slap');
    expect(s.pose.left).not.toBe('windup');
    await expectNoErrors(errors);
  });

  test('feinte trop longue : la gifle part toute seule après 0,8 s', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left', 'banner');
    await logPhases(page);
    await scriptTouches(page, READY_LEFT, bernardSlap(false));
    await waitTurn(page, 'right', 'banner');
    const log = await phases(page);
    const at = (p: string) => log.find(([, name]) => name === p)?.[0] ?? NaN;
    expect(at('travel') - at('armed')).toBeGreaterThan(650);
    expect(at('travel') - at('armed')).toBeLessThan(1400);
    expect((await state(page)).last!.kind).toBe('slap');
    await scriptTouches(page, 'true', [{ at: 0, type: 'up', x: 520, y: 232 }]);
    await expectNoErrors(errors);
  });

  test('garde de rage : swipe vers le bas, esquive parfaite garantie, la rage est dépensée', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left', 'banner');
    await onScene(page, "sc.match.rage.right = 100; sc.match.specialReady.right = true; sc.f.right.bar.setRage(1); sc.showReady('right', true);");
    await waitTurn(page, 'left');
    expect((await state(page)).hint).toContain('glisse vers le bas');
    await armFreezeOn(page, "fx.frozen === false && s.last && s.last.dodge === 'rage' && (window.__gT ??= performance.now()) && performance.now() - window.__gT > 60");
    await scriptTouches(page, READY_LEFT, [...bernardSlap(), ...lolaDown(400)]);
    await shootFrozen(page, `${SHOTS}/esquive-garde.png`);
    await waitTurn(page, 'right', 'banner');
    const s = await state(page);
    expect(s.last!.dodge).toBe('rage');
    expect(s.last!.avoided).toBeGreaterThan(0);
    expect(s.specialReady.right).toBe(false);
    expect(s.rage.right).toBe(s.last!.damage);
    expect((await fx(page)).lastKey).toMatch(/^com_guard_\d$/);
    await expectNoErrors(errors);
  });

  test('droit de réponse : celui qui ouvre met K.O., l’autre rend une dernière gifle', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left');
    await onScene(page, 'sc.match.hp.right = 3; sc.f.right.hp = 3; sc.f.right.bar.setValue(0.03, true);');
    await armFreezeOn(page, "s.lastWord === 'right' && s.pose.right === 'idle' && (window.__lT ??= performance.now()) && performance.now() - window.__lT > 450");
    await scriptTouches(page, READY_LEFT, bernardSlap());
    await shootFrozen(page, `${SHOTS}/esquive-droit-de-reponse.png`);
    await waitTurn(page, 'right');
    let s = await state(page);
    expect(s.hp.right).toBe(0);
    expect(s.lastWord).toBe('right');
    expect(s.wins).toEqual({ left: 0, right: 0 });
    expect((await fx(page)).lastKey).toMatch(/^com_lastWord_\d$/);
    // Lola répond (gifle moyenne) : Bernard n'est pas K.O., le round est pour lui.
    await scriptTouches(page, "s.scenePhase === 'ready' && s.attacker === 'right'", [{ at: 0, type: 'down', id: 2, x: 620, y: 230 }, ...swipeSteps(500, 620, 230, 400, 232, 60, 2).slice(1)]);
    await page.waitForFunction(() => (window.__slap?.state as { wins?: { left: number } }).wins?.left === 1, null, { timeout: 15_000 });
    s = await state(page);
    expect(s.hp.left).toBeLessThan(100);
    expect(s.hp.left).toBeGreaterThan(0);
    expect(s.wins).toEqual({ left: 1, right: 0 });
    await expectNoErrors(errors);
  });

  test('double K.O. : les deux tombent, le moins amoché gagne le round', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await page.goto('./?mode=match&seed=3');
    await waitTurn(page, 'left');
    await onScene(page, 'sc.match.hp.right = 3; sc.f.right.hp = 3; sc.f.right.bar.setValue(0.03, true); sc.match.hp.left = 2; sc.f.left.hp = 2; sc.f.left.bar.setValue(0.02, true);');
    await scriptTouches(page, READY_LEFT, bernardSlap());
    await armFreezeOn(page, "s.scenePhase === 'roundEnd' && (window.__kT ??= performance.now()) && performance.now() - window.__kT > 500");
    await scriptTouches(page, "s.scenePhase === 'ready' && s.attacker === 'right'", [{ at: 0, type: 'down', id: 2, x: 620, y: 230 }, ...swipeSteps(500, 620, 230, 400, 232, 60, 2).slice(1)]);
    await shootFrozen(page, `${SHOTS}/esquive-double-ko.png`);
    await page.waitForFunction(() => (window.__slap?.state as { round?: number }).round === 2, null, { timeout: 20_000 });
    const s = await state(page);
    expect(s.wins.left + s.wins.right).toBe(1);
    expect((await fx(page)).sounds).toContain('ko');
    console.log(`double K.O. : round pour ${s.wins.left ? 'Bernard' : 'Lola'}`);
    await expectNoErrors(errors);
  });

  test('solo : l’IA esquive et feinte, le joueur esquive les gifles de l’IA', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await page.goto('./?mode=solo&level=hard&seed=11');
    // Le joueur (à gauche) recule à chaque gifle de l'IA, et gifle à chacun de ses tours.
    await page.waitForFunction(() => (window.__slap?.state as { scenePhase?: string } | undefined)?.scenePhase !== undefined);
    await dodgeOnTravel(page, { side: 'right', afterMs: 230, from: [300, 230], to: [220, 230], repeat: true });
    const result = await page.evaluate(
      () =>
        new Promise<{ mine: (string | null)[]; ai: (string | null)[]; winner: string | null }>((resolve) => {
          const canvas = document.querySelector('canvas')!;
          const fire = (name: string, x: number, y: number, stamp: number) => {
            const t = new Touch({ identifier: 1, target: canvas, clientX: x, clientY: y, pageX: x, pageY: y });
            const ev = new TouchEvent(name, { bubbles: true, cancelable: true, touches: name === 'touchend' ? [] : [t], changedTouches: [t] });
            Object.defineProperty(ev, 'timeStamp', { value: stamp });
            canvas.dispatchEvent(ev);
          };
          const mine: (string | null)[] = [];
          const ai: (string | null)[] = [];
          let key = '';
          let seen = 0;
          const id = setInterval(() => {
            const s = window.__slap!.state as unknown as { scenePhase: string; attacker: string; turns: number; slaps: number; winner: string | null; last: { dodge?: string | null } | null };
            if (s.slaps !== seen && s.last && 'dodge' in s.last) {
              seen = s.slaps;
              // Le coup vient d'être porté par celui dont c'est (encore) le tour.
              (s.attacker === 'left' ? ai : mine).push(s.last.dodge ?? null);
            }
            // Six gifles reçues suffisent (un match entier à tout esquiver serait long).
            if (s.scenePhase === 'over' || mine.length >= 6) {
              clearInterval(id);
              resolve({ mine, ai, winner: s.winner });
              return;
            }
            const k = `${s.turns}-${s.attacker}-${s.scenePhase}`;
            if (k === key || s.scenePhase !== 'ready' || s.attacker !== 'left') return;
            key = k;
            const t0 = performance.now();
            fire('touchstart', 300, 230, t0);
            setTimeout(() => {
              fire('touchmove', 380, 231, t0 + 750);
              fire('touchmove', 520, 232, t0 + 790);
              fire('touchend', 520, 232, t0 + 800);
            }, 800);
          }, 1);
        }),
    );
    console.log(`solo : mes esquives ${JSON.stringify(result.mine)} · esquives de l'IA ${JSON.stringify(result.ai)} · vainqueur ${result.winner}`);
    expect(result.mine.length).toBeGreaterThanOrEqual(3);
    expect(result.mine.filter(Boolean).length).toBeGreaterThanOrEqual(result.mine.length / 2);
    expect(result.ai.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    await expectNoErrors(errors);
  });
});
