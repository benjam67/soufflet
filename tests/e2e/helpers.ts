import { expect, type CDPSession, type Page } from '@playwright/test';
import fs from 'node:fs';

export const SHOTS = 'screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

export interface SlapState {
  mode: string;
  phase: 'ready' | 'charging' | 'busy';
  attacker: 'left' | 'right';
  hp: { left: number; right: number };
  pose: { left: string; right: string };
  slaps: number;
  last: null | { kind: string; damage: number; critical?: boolean };
}

/** Erreurs console et JS de la page (les polices Google bloquées par le réseau de test sont ignorées). */
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url.includes('fonts.g')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => {
    if (!r.url().includes('fonts.g')) errors.push(`requête échouée : ${r.url()}`);
  });
  return errors;
}

export async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__slap?.ready === true, null, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

export const getState = (page: Page) => page.evaluate(() => window.__slap!.state as unknown as SlapState);

export async function waitPhase(page: Page, phase: SlapState['phase'], timeout = 5000) {
  await page.waitForFunction((p) => (window.__slap?.state as { phase?: string } | undefined)?.phase === p, phase, { timeout });
}

/** Doigt virtuel : vrais événements tactiles envoyés par le protocole DevTools. */
export class Finger {
  private constructor(private cdp: CDPSession) {}

  static async on(page: Page) {
    return new Finger(await page.context().newCDPSession(page));
  }

  down(x: number, y: number) {
    return this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  }

  move(x: number, y: number) {
    return this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }

  up() {
    return this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  /** Swipe de (x0,y0) à (x1,y1) en `ms` millisecondes, par petits pas. */
  async swipe(page: Page, x0: number, y0: number, x1: number, y1: number, ms: number, steps = 6) {
    for (let i = 1; i <= steps; i++) {
      await this.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      await page.waitForTimeout(ms / steps);
    }
  }
}

export async function expectNoErrors(errors: string[]) {
  expect(errors, errors.join('\n')).toEqual([]);
}

/**
 * Met la boucle du jeu en pause dès que `cond` devient vrai (vérifié à chaque milliseconde),
 * pour photographier l'instant exact d'un effet.
 */
export async function armFreezeOn(page: Page, cond: string) {
  await page.evaluate((c) => {
    const check = new Function('s', 'fx', `return (${c});`) as (s: unknown, fx: unknown) => boolean;
    const w = window as unknown as { __froze?: boolean };
    w.__froze = false;
    const id = setInterval(() => {
      const slap = window.__slap as unknown as { state: unknown; fx: unknown; game: { loop: { sleep: () => void } } };
      if (slap?.fx && check(slap.state, slap.fx)) {
        slap.game.loop.sleep();
        w.__froze = true;
        clearInterval(id);
      }
    }, 1);
  }, cond);
}
export async function shootFrozen(page: Page, path: string) {
  await page.waitForFunction(() => (window as unknown as { __froze?: boolean }).__froze === true, null, { timeout: 15_000 });
  await page.screenshot({ path });
  await page.evaluate(() => (window.__slap as unknown as { game: { loop: { wake: () => void } } }).game.loop.wake());
}


export interface TouchStep {
  /** Instant de l'événement, en ms après le déclenchement. */
  at: number;
  type: 'down' | 'move' | 'up';
  /** Doigt (1 par défaut) : deux doigts peuvent jouer en même temps. */
  id?: number;
  x: number;
  y: number;
}

/** Swipe d'un doigt : appui, quelques déplacements, lever. */
export function swipeSteps(at: number, x0: number, y0: number, x1: number, y1: number, ms = 50, id = 1, lift = true): TouchStep[] {
  const steps: TouchStep[] = [{ at, type: 'down', id, x: x0, y: y0 }];
  const n = 3;
  for (let i = 1; i <= n; i++) steps.push({ at: at + (ms * i) / n, type: 'move', id, x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n });
  if (lift) steps.push({ at: at + ms + 8, type: 'up', id, x: x1, y: y1 });
  return steps;
}

/**
 * Gestes joués DANS la page, image par image : ils démarrent dès que `when` devient vrai
 * (expression sur l'état `s` et les effets `fx`), puis chaque événement part quand le temps du JEU
 * a avancé de `at` ms. Chaque événement porte l'heure voulue (début + `at`), comme un vrai doigt.
 * Les allers-retours avec le navigateur de test et ses minuteries sont trop irréguliers pour les
 * gestes à timing serré (rythme de La Toupie, feinte) : ici tout suit l'horloge du jeu.
 * La promesse se résout quand tous les gestes sont joués.
 */
export function scriptTouches(page: Page, when: string, steps: TouchStep[], timeout = 20_000) {
  return page.evaluate(
    ({ when, steps, timeout }) =>
      new Promise<number>((resolve, reject) => {
        const check = new Function('s', 'fx', `return (${when});`) as (s: unknown, fx: unknown) => boolean;
        const canvas = document.querySelector('canvas')!;
        const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as {
          events: { on: (e: string, f: (t: number, d: number) => void) => void; off: (e: string, f: (t: number, d: number) => void) => void };
        };
        const active = new Map<number, Touch>();
        const fire = (st: (typeof steps)[number], stamp: number) => {
          const id = st.id ?? 1;
          const touch = new Touch({ identifier: id, target: canvas, clientX: st.x, clientY: st.y, pageX: st.x, pageY: st.y });
          if (st.type === 'up') active.delete(id);
          else active.set(id, touch);
          const name = st.type === 'down' ? 'touchstart' : st.type === 'move' ? 'touchmove' : 'touchend';
          const ev = new TouchEvent(name, { bubbles: true, cancelable: true, touches: [...active.values()], targetTouches: [...active.values()], changedTouches: [touch] });
          Object.defineProperty(ev, 'timeStamp', { value: stamp });
          canvas.dispatchEvent(ev);
        };
        const sorted = [...steps].sort((a, b) => a.at - b.at);
        const t0 = performance.now();
        let start = -1;
        let elapsed = 0;
        let i = 0;
        const onUpdate = (_t: number, delta: number) => {
          const slap = window.__slap as unknown as { state: unknown; fx: unknown };
          if (start < 0) {
            if (performance.now() - t0 > timeout) {
              sc.events.off('update', onUpdate);
              reject(new Error(`scriptTouches : « ${when} » jamais vrai`));
            } else if (slap?.state && check(slap.state, slap.fx)) start = performance.now();
            if (start < 0) return;
          } else elapsed += delta;
          while (i < sorted.length && elapsed >= sorted[i].at) fire(sorted[i], start + sorted[i++].at);
          if (i >= sorted.length) {
            sc.events.off('update', onUpdate);
            resolve(elapsed);
          }
        };
        sc.events.on('update', onUpdate);
      }),
    { when, steps, timeout },
  );
}

/**
 * Fait reculer (ou baisser) le doigt de celui qui reçoit quand la gifle en route en est à
 * `afterMs` de son trajet (360 ms au total), en suivant le temps du jeu image par image.
 * `side` : celui qui gifle. `repeat` : à chaque gifle (sinon une seule fois).
 */
export function dodgeOnTravel(page: Page, o: { side: 'left' | 'right'; afterMs: number; from: [number, number]; to: [number, number]; id?: number; repeat?: boolean }) {
  return page.evaluate((o) => {
    const canvas = document.querySelector('canvas')!;
    const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as {
      events: { on: (e: string, f: () => void) => void; off: (e: string, f: () => void) => void };
      phase: string;
      attacker: string;
      travelMs: number;
      pending: unknown;
    };
    let done: unknown = null;
    const fire = (name: string, [x, y]: [number, number]) => {
      const t = new Touch({ identifier: o.id ?? 1, target: canvas, clientX: x, clientY: y, pageX: x, pageY: y });
      canvas.dispatchEvent(new TouchEvent(name, { bubbles: true, cancelable: true, touches: name === 'touchend' ? [] : [t], targetTouches: name === 'touchend' ? [] : [t], changedTouches: [t] }));
    };
    const onUpdate = () => {
      if (sc.phase !== 'travel' || sc.attacker !== o.side || sc.travelMs < o.afterMs || sc.pending === done) return;
      done = sc.pending;
      fire('touchstart', o.from);
      fire('touchmove', o.to);
      fire('touchend', o.to);
      if (!o.repeat) sc.events.off('update', onUpdate);
    };
    sc.events.on('update', onUpdate);
  }, o);
}
