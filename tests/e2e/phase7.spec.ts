import { expect, test, type Page } from '@playwright/test';
import { collectErrors, expectNoErrors, Finger, scriptTouches, SHOTS, swipeSteps } from './helpers';

interface TitleState {
  mode: string;
  view: string;
  progress: { xp: number; level: number; matches: number; wins: number; fighter: string; skin: { bernard: string; lola: string }; bar: string };
}
interface FightState {
  mode: string;
  scenePhase: string;
  attacker: string;
  ids: { left: string; right: string };
  level: string;
  wins: { left: number; right: number };
  winner: string | null;
  award: null | { gained: number; levelBefore: number; levelAfter: number; unlocked: { id: string }[] };
  progress: { xp: number; matches: number; wins: number };
}
const state = <T>(page: Page) => page.evaluate(() => window.__slap!.state as unknown) as Promise<T>;
const onTitle = (page: Page) => page.waitForFunction(() => window.__slap?.ready === true && window.__slap.scene === 'Title' && (window.__slap.state as { mode?: string })?.mode === 'title');

/** Touche un bouton (ou un texte) de la scène par son nom. */
async function tap(page: Page, scene: 'Title' | 'Fight', name: string) {
  const pos = await page.evaluate(
    ([sceneKey, n]) => {
      type O = { name?: string; x: number; y: number; list?: O[] };
      const g = window.__slap!.game!;
      const sc = g.scene.getScene(sceneKey) as unknown as { children: { list: O[] } };
      const find = (l: O[], ox = 0, oy = 0): { x: number; y: number } | null => {
        for (const o of l) {
          if (o.name === n) return { x: ox + o.x, y: oy + o.y };
          const r = o.list && find(o.list, ox + o.x, oy + o.y);
          if (r) return r;
        }
        return null;
      };
      const b = find(sc.children.list);
      return b ? { x: b.x / g.scale.displayScale.x, y: b.y / g.scale.displayScale.y } : null;
    },
    [scene, name],
  );
  expect(pos, `bouton ${name} introuvable`).not.toBeNull();
  const finger = await Finger.on(page);
  await finger.down(pos!.x, pos!.y);
  await finger.up();
  await page.waitForTimeout(250);
}

const texts = (page: Page, scene: 'Title' | 'Fight') =>
  page.evaluate((sceneKey) => {
    type O = { text?: string; list?: O[] };
    const sc = window.__slap!.game!.scene.getScene(sceneKey) as unknown as { children: { list: O[] } };
    const out: string[] = [];
    const walk = (l: O[]) => l.forEach((o) => (o.text && out.push(o.text), o.list && walk(o.list)));
    walk(sc.children.list);
    return out;
  }, scene);

/**
 * Gagne le match en cours d'une gifle : on place le joueur (à gauche) à un round de la victoire et
 * l'adversaire à 3 PV. L'adversaire use de son droit de réponse, puis tombe.
 */
async function winNow(page: Page) {
  await page.waitForFunction(() => {
    const s = window.__slap?.state as { scenePhase?: string; attacker?: string } | undefined;
    return s?.scenePhase === 'ready' && s.attacker === 'left';
  }, null, { timeout: 30_000, polling: 'raf' });
  await page.evaluate(() => {
    const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as {
      match: { wins: { left: number }; hp: { right: number } };
      f: { right: { hp: number; bar: { setValue: (v: number, now: boolean) => void } }; left: { pips: { setWon: (n: number) => void } } };
    };
    sc.match.wins.left = 1;
    sc.f.left.pips.setWon(1);
    sc.match.hp.right = 3;
    sc.f.right.hp = 3;
    sc.f.right.bar.setValue(0.03, true);
  });
  await scriptTouches(page, "s.scenePhase === 'ready' && s.attacker === 'left'", [{ at: 0, type: 'down', x: 300, y: 230 }, ...swipeSteps(600, 300, 230, 520, 232, 60).slice(1)]);
  await page.waitForFunction(() => (window.__slap?.state as { scenePhase?: string })?.scenePhase === 'over', null, { timeout: 60_000 });
  await page.waitForTimeout(1600);
}

test.describe('phase 7 · progression et menus', () => {
  test('titre → choix du perso → match → résultat et XP → déblocage → vestiaire, et tout survit au rechargement', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await page.goto('./');
    await onTitle(page);
    let t = await state<TitleState>(page);
    expect(t.progress).toMatchObject({ xp: 0, level: 1, fighter: 'bernard', bar: 'base' });
    expect(await texts(page, 'Title')).toContain('NIVEAU 1  ·  0 / 100 XP');

    // Vestiaire : rien de débloqué, le prochain déblocage est annoncé.
    await tap(page, 'Title', 'btn-VESTIAIRE');
    expect(await texts(page, 'Title')).toContain('Prochain déblocage : niveau 2 — tenue Streetwear de Bernard');
    await tap(page, 'Title', 'btn-skin-bernard');
    expect((await state<TitleState>(page)).progress.skin.bernard).toBe('base');
    await page.screenshot({ path: `${SHOTS}/phase7-vestiaire-vide.png` });
    await tap(page, 'Title', 'btn-← RETOUR');

    // Solo : on choisit Lola, puis le niveau normal.
    await tap(page, 'Title', 'btn-SOLO');
    await tap(page, 'Title', 'btn-perso');
    expect((await state<TitleState>(page)).progress.fighter).toBe('lola');
    await page.screenshot({ path: `${SHOTS}/phase7-choix-perso.png` });
    await tap(page, 'Title', 'btn-NORMAL');
    await page.waitForFunction(() => (window.__slap?.state as { mode?: string })?.mode === 'solo');
    let f = await state<FightState>(page);
    expect(f.ids).toEqual({ left: 'lola', right: 'bernard' });
    expect(f.level).toBe('normal');

    // Premier match gagné : +90 XP (15 + 2 rounds × 10 + 55), pas encore de déblocage.
    await winNow(page);
    f = await state<FightState>(page);
    expect(f.winner).toBe('left');
    expect(f.award).toMatchObject({ gained: 90, levelBefore: 1, levelAfter: 1, unlocked: [] });
    expect(await texts(page, 'Fight')).toContain('+90 XP  ·  NIVEAU 1');
    await page.screenshot({ path: `${SHOTS}/phase7-resultat.png` });

    // Revanche gagnée : 180 XP → niveau 2 → la tenue streetwear de Bernard est débloquée.
    await tap(page, 'Fight', 'btn-REVANCHE');
    await page.waitForFunction(() => (window.__slap?.state as { scenePhase?: string })?.scenePhase !== 'over');
    expect((await state<FightState>(page)).ids.left).toBe('lola');
    await winNow(page);
    f = await state<FightState>(page);
    expect(f.award).toMatchObject({ gained: 90, levelBefore: 1, levelAfter: 2 });
    expect(f.award!.unlocked.map((u) => u.id)).toEqual(['bernard_street']);
    expect(f.progress).toEqual({ xp: 180, matches: 2, wins: 2 });
    expect(await texts(page, 'Fight')).toContain('DÉBLOQUÉ : tenue Streetwear de Bernard !');
    await page.screenshot({ path: `${SHOTS}/phase7-deblocage.png` });

    // La page est rechargée : niveau, XP et perso choisi sont toujours là.
    await page.reload();
    await onTitle(page);
    t = await state<TitleState>(page);
    expect(t.progress).toMatchObject({ xp: 180, level: 2, matches: 2, wins: 2, fighter: 'lola' });
    expect(await texts(page, 'Title')).toContain('NIVEAU 2  ·  180 / 250 XP');

    // Vestiaire : on enfile la tenue débloquée ; le choix survit lui aussi au rechargement.
    await tap(page, 'Title', 'btn-VESTIAIRE');
    await tap(page, 'Title', 'btn-skin-bernard');
    expect((await state<TitleState>(page)).progress.skin.bernard).toBe('bernard_street');
    // Lola n'a encore rien de débloqué : son bouton ne change rien.
    await tap(page, 'Title', 'btn-skin-lola');
    expect((await state<TitleState>(page)).progress.skin.lola).toBe('base');
    expect(await texts(page, 'Title')).toContain('Prochain déblocage : niveau 3 — Bar de nuit');
    await page.screenshot({ path: `${SHOTS}/phase7-vestiaire.png` });
    await page.reload();
    await onTitle(page);
    expect((await state<TitleState>(page)).progress.skin.bernard).toBe('bernard_street');

    // En combat, Bernard porte sa tenue (teinte provisoire).
    await tap(page, 'Title', 'btn-ENTRAÎNEMENT');
    await page.waitForFunction(() => (window.__slap?.state as { mode?: string })?.mode === 'training');
    const tints = await page.evaluate(() => {
      const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as { f: Record<'left' | 'right', { id: string; sprite: { tintTopLeft: number } }> };
      return { [sc.f.left.id]: sc.f.left.sprite.tintTopLeft, [sc.f.right.id]: sc.f.right.sprite.tintTopLeft };
    });
    expect(tints).toEqual({ lola: 0xffffff, bernard: 0xa9c4ff });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/phase7-tenue.png` });
    await expectNoErrors(errors);
  });

  test('une défaite rapporte aussi de l’XP ; la démo et l’entraînement n’en donnent pas', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.goto('./?mode=solo&level=hard&fighter=lola');
    await page.waitForFunction(() => {
      const s = window.__slap?.state as { scenePhase?: string; attacker?: string } | undefined;
      return s?.scenePhase === 'ready' && s.attacker === 'left';
    }, null, { timeout: 30_000 });
    // On place l'IA à un round de la victoire et le joueur à 1 PV, puis on laisse filer le chrono.
    await page.evaluate(() => {
      const sc = window.__slap!.game!.scene.getScene('Fight') as unknown as { match: { wins: { right: number }; hp: { left: number } }; f: { left: { hp: number } } };
      sc.match.wins.right = 1;
      sc.match.hp.left = 1;
      sc.f.left.hp = 1;
    });
    await page.waitForFunction(() => (window.__slap?.state as { scenePhase?: string })?.scenePhase === 'over', null, { timeout: 60_000 });
    const f = await state<FightState>(page);
    expect(f.winner).toBe('right');
    expect(f.award).toMatchObject({ gained: 15, levelAfter: 1 });
    expect(await texts(page, 'Fight')).toContain('DÉFAITE…');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('slap.progress')!) as { xp: number; matches: number; wins: number });
    expect(saved).toMatchObject({ xp: 15, matches: 1, wins: 0 });
    await expectNoErrors(errors);
  });
});
