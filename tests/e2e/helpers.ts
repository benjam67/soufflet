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

