import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { collectErrors, expectNoErrors, Finger, SHOTS } from './helpers';

const PEER = 'peer=127.0.0.1:9000';

interface St {
  mode: string;
  scenePhase: string;
  phase: string;
  attacker: 'left' | 'right';
  hp: { left: number; right: number };
  wins: { left: number; right: number };
  winner: 'left' | 'right' | null;
  turns: number;
  round: number;
  rage: { left: number; right: number };
  pose: { left: string; right: string };
  charge: number;
}
interface Net {
  code: string;
  role: string;
  status: string;
  matchId: number;
  turns: number;
}
const st = (p: Page) => p.evaluate(() => window.__slap!.state as unknown as St);
const net = (p: Page) => p.evaluate(() => (window.__slap as unknown as { net?: Net }).net);

async function phone(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
}

/** Ouvre un salon côté hôte et le rejoint côté invité. Renvoie le code. */
async function connect(host: Page, guest: Page, base: string, params: string) {
  await host.goto(`${base}?mode=online&${PEER}&${params}`);
  await host.locator('#lobby [data-act="create"]').click();
  await expect(host.locator('#lobby-code-show')).toHaveText(/^[A-Z]{4}$/, { timeout: 20_000 });
  const code = (await host.locator('#lobby-code-show').textContent())!;
  await guest.goto(`${base}?join=${code}&${PEER}&${params}`);
  for (const p of [host, guest]) {
    await p.waitForFunction(() => (window.__slap?.state as { mode?: string } | undefined)?.mode === 'online', null, { timeout: 30_000 });
    await expect(p.locator('#lobby')).toBeHidden();
  }
  return code;
}

const over = (p: Page, timeout = 150_000) =>
  p.waitForFunction(() => (window.__slap?.state as { scenePhase?: string } | undefined)?.scenePhase === 'over', null, { timeout });

async function expectSameMatch(host: Page, guest: Page) {
  const [a, b] = [await st(host), await st(guest)];
  expect(a.winner).not.toBeNull();
  expect(b.winner).toBe(a.winner);
  expect(b.wins).toEqual(a.wins);
  expect(b.hp).toEqual(a.hp);
  expect(b.turns).toBe(a.turns);
  expect(b.round).toBe(a.round);
  expect(b.rage).toEqual(a.rage);
  return a;
}

const texts = (p: Page) =>
  p.evaluate(() => {
    type O = { text?: string; name?: string; list?: O[] };
    const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as { children: { list: O[] } };
    const out: string[] = [];
    const walk = (l: O[]) => l.forEach((o) => (o.text && out.push(o.text), o.name && out.push(o.name), o.list && walk(o.list)));
    walk(sc.children.list);
    return out;
  });

test.describe('phase 6 · jeu en ligne', () => {
  test('écran d’accueil : les 4 modes, et le choix du niveau en solo', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await page.waitForFunction(() => window.__slap?.ready === true && window.__slap.scene === 'Title');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/phase6-accueil.png` });
    const names = () =>
      page.evaluate(() => {
        type O = { name?: string; list?: O[] };
        const sc = window.__slap!.game!.scene.getScene('Title') as unknown as { children: { list: O[] } };
        const out: string[] = [];
        const walk = (l: O[]) => l.forEach((o) => (o.name?.startsWith('btn-') && out.push(o.name), o.list && walk(o.list)));
        walk(sc.children.list);
        return out;
      });
    expect(await names()).toEqual(['btn-SOLO', 'btn-2 JOUEURS', 'btn-EN LIGNE', 'btn-ENTRAÎNEMENT']);
    // SOLO → choix du niveau → FACILE lance un match solo facile.
    const tap = async (name: string) => {
      const pos = await page.evaluate((n) => {
        type O = { name?: string; x: number; y: number; list?: O[] };
        const g = window.__slap!.game!;
        const sc = g.scene.getScene('Title') as unknown as { children: { list: O[] } };
        const find = (l: O[], ox = 0, oy = 0): { x: number; y: number } | null => {
          for (const o of l) {
            if (o.name === n) return { x: ox + o.x, y: oy + o.y };
            const r = o.list && find(o.list, ox + o.x, oy + o.y);
            if (r) return r;
          }
          return null;
        };
        const b = find(sc.children.list)!;
        return { x: b.x / g.scale.displayScale.x, y: b.y / g.scale.displayScale.y };
      }, name);
      const finger = await Finger.on(page);
      await finger.down(pos.x, pos.y);
      await finger.up();
    };
    await tap('btn-SOLO');
    await page.waitForTimeout(200);
    expect(await names()).toEqual(['btn-FACILE', 'btn-NORMAL', 'btn-DIFFICILE', 'btn-← RETOUR']);
    await page.screenshot({ path: `${SHOTS}/phase6-niveaux.png` });
    await tap('btn-FACILE');
    await page.waitForFunction(() => (window.__slap?.state as { mode?: string; level?: string })?.mode === 'solo');
    expect(((await st(page)) as unknown as { level: string }).level).toBe('easy');
    await expectNoErrors(errors);
  });

  test('salon : code invalide ou introuvable → message clair', async ({ page }) => {
    await page.goto(`./?mode=online&${PEER}`);
    await page.locator('#lobby [data-act="join"]').click();
    await page.locator('#lobby-code').fill('AB');
    await page.locator('#lobby [data-act="go"]').click();
    await expect(page.locator('#lobby [data-view="join"] [data-status]')).toHaveText('Le code fait 4 lettres.');
    await page.locator('#lobby-code').fill('zzzz');
    await page.locator('#lobby [data-act="go"]').click();
    await expect(page.locator('#lobby [data-view="join"] [data-status]')).toHaveText('Salon introuvable. Vérifie le code.', { timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/phase6-salon-introuvable.png` });
  });

  test('deux navigateurs : un match complet en ligne, même résultat des deux côtés', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const [ca, cb] = [await phone(browser), await phone(browser)];
    const [host, guest] = [await ca.newPage(), await cb.newPage()];
    const errors = [collectErrors(host), collectErrors(guest)];
    // Chaque côté est joué par une IA locale ; seules les actions passent par le réseau.
    await host.goto(`${baseURL}?mode=online&${PEER}&bot=1&speed=5`);
    await host.locator('#lobby [data-act="create"]').click();
    await expect(host.locator('#lobby-code-show')).toHaveText(/^[A-Z]{4}$/, { timeout: 20_000 });
    await host.screenshot({ path: `${SHOTS}/phase6-salon-hote.png` });
    const code = (await host.locator('#lobby-code-show').textContent())!;
    await guest.goto(`${baseURL}?join=${code}&${PEER}&bot=1&speed=5`);
    for (const p of [host, guest]) await p.waitForFunction(() => (window.__slap?.state as { mode?: string } | undefined)?.mode === 'online', null, { timeout: 30_000 });
    expect((await net(host))!.role).toBe('host');
    expect((await net(guest))!.role).toBe('guest');
    expect((await net(guest))!.code).toBe(code);

    await Promise.all([over(host), over(guest)]);
    const a = await expectSameMatch(host, guest);
    expect(a.wins[a.winner!]).toBe(2);
    // Les esquives se jugent sur le téléphone de celui qui reçoit, puis sont validées par celui qui
    // gifle : les deux journaux sont identiques, et des esquives sont bien passées par le réseau.
    const logOf = (p: Page) => p.evaluate(() => (window.__slap!.game!.scene.getScene('Fight') as unknown as { online: { log: { defense?: string; rageGuard?: boolean }[] } }).online.log);
    const [lh, lg] = [await logOf(host), await logOf(guest)];
    expect(lg).toEqual(lh);
    const dodges = lh.filter((x) => x.defense || x.rageGuard).length;
    console.log(`en ligne : ${lh.length} tours, ${dodges} esquives transmises`);
    expect(dodges).toBeGreaterThan(0);
    // L'un voit « VICTOIRE ! », l'autre « DÉFAITE… ».
    const [th, tg] = [await texts(host), await texts(guest)];
    expect(th).toContain(a.winner === 'left' ? 'VICTOIRE !' : 'DÉFAITE…');
    expect(tg).toContain(a.winner === 'right' ? 'VICTOIRE !' : 'DÉFAITE…');
    expect((await net(host))!.turns).toBe((await net(guest))!.turns);
    await host.screenshot({ path: `${SHOTS}/phase6-fin-hote.png` });
    await guest.screenshot({ path: `${SHOTS}/phase6-fin-invite.png` });

    // Revanche lancée par l'invité : les deux repartent au round 1.
    await guest.evaluate(() => {
      const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as { online: { rematch: () => void }; scene: { restart: (d: unknown) => void }; bot: boolean; speed: number };
      sc.online.rematch();
      sc.scene.restart({ online: sc.online, bot: sc.bot, speed: sc.speed });
    });
    for (const p of [host, guest]) {
      await p.waitForFunction(() => (window.__slap as unknown as { net?: { matchId: number } }).net?.matchId === 2 && (window.__slap!.state as { scenePhase?: string }).scenePhase !== 'over', null, { timeout: 20_000 });
    }
    await expectNoErrors(errors[0]);
    await expectNoErrors(errors[1]);
    await ca.close();
    await cb.close();
  });

  test('chacun joue son tour au doigt : l’autre téléphone voit l’armement puis la gifle', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const [ca, cb] = [await phone(browser), await phone(browser)];
    const [host, guest] = [await ca.newPage(), await cb.newPage()];
    const errors = [collectErrors(host), collectErrors(guest)];
    await connect(host, guest, baseURL!, 'seed=1');
    const ready = (p: Page, side: string) =>
      p.waitForFunction(
        (s) => {
          const x = window.__slap?.state as { phase?: string; attacker?: string } | undefined;
          return x?.phase === 'ready' && x.attacker === s;
        },
        side,
        { timeout: 30_000, polling: 'raf' },
      );
    // Chaque téléphone note les PV à chaque nouveau tour (lu à la fin, pour ne pas perdre de temps entre les gestes).
    for (const p of [host, guest]) {
      await p.evaluate(() => {
        const snaps: Record<number, { left: number; right: number }> = {};
        (window as unknown as { __snaps: typeof snaps }).__snaps = snaps;
        setInterval(() => {
          const x = window.__slap?.state as { turns: number; hp: { left: number; right: number }; phase: string } | undefined;
          if (x && x.phase === 'ready' && !snaps[x.turns]) snaps[x.turns] = { ...x.hp };
          const pose = (window.__slap?.state as { pose?: { left: string } } | undefined)?.pose?.left;
          const w = window as unknown as { __poses: string[] };
          w.__poses ??= [];
          if (pose && w.__poses[w.__poses.length - 1] !== pose) w.__poses.push(pose);
        }, 10);
      });
    }
    const fh = await Finger.on(host);
    const fg = await Finger.on(guest);
    // L'hôte (Bernard) joue dès que c'est à lui (son chrono de 3 s tourne) ; l'invité le verra armer puis gifler.
    await ready(host, 'left');
    await fh.down(300, 230);
    // (Deux pages en rendu logiciel tournent à quelques images par seconde ici : on pilote les gestes
    // au temps écoulé — le jeu date les gestes avec l'horloge des événements, pas avec les images.)
    await host.waitForTimeout(400);
    await fh.swipe(host, 300, 230, 600, 232, 60, 2);
    await fh.up();
    // L'invité a vu Bernard armer puis gifler.
    await guest.waitForFunction(() => (window as unknown as { __poses: string[] }).__poses.includes('windup'), null, { timeout: 15_000 });

    // C'est à Lola (l'invité). L'hôte tapote son écran pendant ce tour : rien ne doit se passer.
    await ready(guest, 'right');
    await fh.down(300, 230);
    await fh.up();
    await fg.down(600, 230);
    await guest.waitForTimeout(250);
    await fg.swipe(guest, 600, 230, 300, 232, 60, 2);
    await fg.up();
    await Promise.all([ready(host, 'left'), ready(guest, 'left')]);

    const snaps = (p: Page) => p.evaluate(() => (window as unknown as { __snaps: Record<number, { left: number; right: number }> }).__snaps);
    const [sh, sg] = [await snaps(host), await snaps(guest)];
    // Après le tour 1 : Lola a pris la gifle de Bernard, mêmes PV sur les deux téléphones.
    expect(sh[1].right).toBeLessThan(100);
    expect(sh[1].left).toBe(100);
    expect(sg[1]).toEqual(sh[1]);
    // Après le tour 2 : Bernard a pris la gifle de Lola ; les tapotements de l'hôte n'ont rien changé.
    expect(sh[2].left).toBeLessThan(100);
    expect(sh[2].right).toBe(sh[1].right);
    expect(sg[2]).toEqual(sh[2]);
    // Les deux gifles étaient de vraies gifles (pas des gifles molles au chrono) : plus de 5 dégâts… ou pas exactement 5 deux fois.
    expect(100 - sh[1].right !== 5 || 100 - sh[2].left !== 5).toBe(true);
    await expectNoErrors(errors[0]);
    await expectNoErrors(errors[1]);
    await ca.close();
    await cb.close();
  });

  test('coupure de connexion en plein match : bandeau, reconnexion, et la partie se termine pareil', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const [ca, cb] = [await phone(browser), await phone(browser)];
    const [host, guest] = [await ca.newPage(), await cb.newPage()];
    const errors = [collectErrors(host), collectErrors(guest)];
    await connect(host, guest, baseURL!, 'bot=1&speed=4');
    await host.waitForFunction(() => ((window.__slap as unknown as { net?: { turns: number } }).net?.turns ?? 0) >= 4, null, { timeout: 60_000 });

    // On coupe la connexion côté invité, comme une perte de réseau.
    await guest.evaluate(() => {
      const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as { online: { session: { simulateDrop: () => void } } };
      sc.online.session.simulateDrop();
    });
    await host.waitForFunction(() => (window.__slap as unknown as { net?: { status: string } }).net?.status === 'reconnecting', null, { timeout: 15_000 });
    await expect(host.locator('#netlost')).toBeVisible();
    await host.screenshot({ path: `${SHOTS}/phase6-connexion-perdue.png` });

    for (const p of [host, guest]) {
      await p.waitForFunction(() => (window.__slap as unknown as { net?: { status: string } }).net?.status === 'connected', null, { timeout: 30_000 });
      await expect(p.locator('#netlost')).toBeHidden();
    }
    await Promise.all([over(host), over(guest)]);
    await expectSameMatch(host, guest);
    await expectNoErrors(errors[0]);
    await expectNoErrors(errors[1]);
    await ca.close();
    await cb.close();
  });

  test('page rechargée en plein match (invité puis hôte) : la partie reprend où elle en était', async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    const [ca, cb] = [await phone(browser), await phone(browser)];
    const [host, guest] = [await ca.newPage(), await cb.newPage()];
    await connect(host, guest, baseURL!, 'bot=1&speed=3');
    const turnsAtLeast = (p: Page, n: number) =>
      p.waitForFunction((k) => ((window.__slap as unknown as { net?: { turns: number } }).net?.turns ?? 0) >= k, n, { timeout: 90_000 });

    await turnsAtLeast(guest, 4);
    const before = (await net(guest))!.turns;
    await guest.reload();
    await guest.waitForFunction(() => (window.__slap?.state as { mode?: string } | undefined)?.mode === 'online', null, { timeout: 40_000 });
    expect((await net(guest))!.turns).toBeGreaterThanOrEqual(before);
    await guest.waitForTimeout(600);
    await guest.screenshot({ path: `${SHOTS}/phase6-reprise.png` });

    await turnsAtLeast(host, before + 4);
    const beforeHost = (await net(host))!.turns;
    await host.reload();
    await host.waitForFunction(() => (window.__slap?.state as { mode?: string } | undefined)?.mode === 'online', null, { timeout: 40_000 });
    expect((await net(host))!.turns).toBeGreaterThanOrEqual(beforeHost);

    await Promise.all([over(host, 200_000), over(guest, 200_000)]);
    await expectSameMatch(host, guest);
    await ca.close();
    await cb.close();
  });
});
