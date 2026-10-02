import { describe, expect, it } from 'vitest';
import { PROGRESS, UNLOCKS } from '../../src/config/progress';
import { award, choices, levelOf, levelProgress, loadProgress, newProgress, nextChoice, nextUnlock, sanitize, saveProgress, tintOf, xpFor, xpForLevel } from '../../src/logic/progress';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('niveaux', () => {
  it('paliers : 100, 250, 450, 700 XP', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 100, 250, 450, 700]);
    expect(levelOf(0)).toBe(1);
    expect(levelOf(99)).toBe(1);
    expect(levelOf(100)).toBe(2);
    expect(levelOf(449)).toBe(3);
    expect(levelOf(1e9)).toBe(PROGRESS.maxLevel);
  });
  it('avancement dans le niveau', () => {
    expect(levelProgress(0)).toBe(0);
    expect(levelProgress(50)).toBeCloseTo(0.5);
    expect(levelProgress(175)).toBeCloseTo(0.5);
    expect(levelProgress(1e9)).toBe(1);
  });
});

describe('XP d’un match', () => {
  it('une victoire rapporte plus qu’une défaite, et plus encore contre une IA forte', () => {
    const lost = xpFor({ kind: 'solo', level: 'normal', won: false, rounds: 1 });
    const easy = xpFor({ kind: 'solo', level: 'easy', won: true, rounds: 2 });
    const normal = xpFor({ kind: 'solo', level: 'normal', won: true, rounds: 2 });
    const hard = xpFor({ kind: 'solo', level: 'hard', won: true, rounds: 2 });
    expect(lost).toBe(25);
    expect(easy).toBe(65);
    expect(normal).toBe(90);
    expect(hard).toBe(125);
    expect(xpFor({ kind: 'online', won: true, rounds: 2 })).toBe(95);
    expect(xpFor({ kind: 'match', won: true, rounds: 2 })).toBe(PROGRESS.xp.local);
  });
  it('même une défaite sèche fait avancer', () => {
    expect(xpFor({ kind: 'solo', level: 'hard', won: false, rounds: 0 })).toBeGreaterThan(0);
  });
});

describe('déblocages', () => {
  it('deux victoires en normal débloquent la tenue streetwear de Bernard (niveau 2)', () => {
    const p = newProgress();
    const a1 = award(p, { kind: 'solo', level: 'normal', won: true, rounds: 2 });
    expect(a1.unlocked).toEqual([]);
    const a2 = award(p, { kind: 'solo', level: 'normal', won: true, rounds: 2 });
    expect(p.xp).toBe(180);
    expect(a2.levelBefore).toBe(1);
    expect(a2.levelAfter).toBe(2);
    expect(a2.unlocked.map((u) => u.id)).toEqual(['bernard_street']);
    expect(p.matches).toBe(2);
    expect(p.wins).toBe(2);
  });
  it('un gros gain peut débloquer plusieurs choses d’un coup', () => {
    const p = newProgress();
    p.xp = 240;
    const a = award(p, { kind: 'solo', level: 'hard', won: true, rounds: 2 });
    expect(a.levelAfter).toBe(3);
    expect(a.unlocked.map((u) => u.id)).toEqual(['bar_night']);
  });
  it('chaque niveau de déblocage est atteignable, et les teintes sont définies', () => {
    for (const u of UNLOCKS) {
      expect(u.level).toBeGreaterThan(1);
      expect(u.level).toBeLessThanOrEqual(PROGRESS.maxLevel);
      expect(tintOf(u.id)).toBe(u.tint);
    }
    expect(tintOf('base')).toBe(0xffffff);
  });
  it('choix proposés : seulement ce qui est débloqué, pour le bon perso', () => {
    expect(choices('skin', 0, 'bernard')).toEqual(['base']);
    expect(choices('skin', xpForLevel(6), 'bernard')).toEqual(['base', 'bernard_street', 'bernard_bronze']);
    expect(choices('skin', xpForLevel(6), 'lola')).toEqual(['base', 'lola_neon']);
    expect(choices('bar', xpForLevel(3))).toEqual(['base', 'bar_night']);
    expect(nextChoice(['base', 'a', 'b'], 'b')).toBe('base');
    expect(nextChoice(['base'], 'base')).toBe('base');
    expect(nextUnlock(0)!.id).toBe('bernard_street');
    expect(nextUnlock(1e9)).toBeNull();
  });
});

describe('sauvegarde', () => {
  it('survit à un aller-retour dans le stockage', () => {
    const store = memory();
    const p = newProgress();
    award(p, { kind: 'solo', level: 'hard', won: true, rounds: 2 });
    p.fighter = 'lola';
    p.skin.bernard = 'bernard_street';
    saveProgress(p, store);
    expect(loadProgress(store)).toEqual(p);
  });
  it('sauvegarde absente, abîmée ou trafiquée : on repart proprement', () => {
    const store = memory();
    expect(loadProgress(store)).toEqual(newProgress());
    store.m.set('slap.progress', '{pas du json');
    expect(loadProgress(store)).toEqual(newProgress());
    // Tenue pas encore débloquée, XP négative, perso inconnu.
    const p = sanitize({ xp: -5, fighter: 'godzilla', skin: { bernard: 'bernard_bronze', lola: 'n/a' }, bar: 'bar_night' });
    expect(p).toEqual(newProgress());
    expect(loadProgress(null)).toEqual(newProgress());
  });
});
