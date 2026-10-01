import { describe, expect, it } from 'vitest';
import { ADVANCED, FIGHTERS, MATCH, SLAP } from '../../src/config/balance';
import { Match, type MatchEvent } from '../../src/logic/match';
import { chargeAt, computeSlap, isOverheated, stunCurve, timeToFull } from '../../src/logic/slap';
import { SlapGesture } from '../../src/logic/gesture';
import { createRng } from '../../src/logic/rng';
import { simulateMany } from '../../src/logic/simulate';

const slap = { type: 'slap', charge: 60, speed: 1.4, angle: 0 } as const;
const miss = { type: 'slap', charge: 1, speed: 0.1, angle: 80 } as const; // 1 dégât
const find = <T extends MatchEvent['type']>(ev: MatchEvent[], t: T) => ev.find((e) => e.type === t) as Extract<MatchEvent, { type: T }> | undefined;

describe('rage', () => {
  it('monte de 1 par dégât reçu', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    const ev = m.play(slap);
    const dmg = find(ev, 'hit')!.damage;
    expect(m.rage.right).toBe(dmg * ADVANCED.ragePerDamage);
    expect(m.rage.left).toBe(0);
  });

  it('compte aussi la gifle molle et la surchauffe (dégâts reçus)', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.play({ type: 'timeout' });
    expect(m.rage.right).toBe(MATCH.limpSlapDamage);
    m.play({ type: 'selfslap' });
    expect(m.rage.right).toBe(MATCH.limpSlapDamage + SLAP.selfSlapDamage);
  });

  it('plafonne à 100 et débloque la spéciale', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.hp.right = 1000; // on ne veut pas de K.O. ici
    m.rage.right = 95;
    const ev = m.play(slap);
    expect(m.rage.right).toBe(ADVANCED.rageMax);
    expect(m.specialReady.right).toBe(true);
    expect(find(ev, 'rageFull')).toEqual({ type: 'rageFull', side: 'right' });
  });

  it('est conservée d’un round à l’autre', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.rage.left = 40;
    m.hp.right = 1;
    m.play(slap);
    m.startRound();
    expect(m.rage.left).toBe(40);
  });
});

describe('gifles spéciales', () => {
  it('Le Battoir : une gifle ×2,0, puis la rage retombe à 0', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.specialReady.left = true;
    m.rage.left = 100;
    const ev = m.play(slap);
    const hit = find(ev, 'hit')!;
    const normal = computeSlap({ attacker: 'bernard', defender: 'lola', charge: 60, speed: 1.4, angle: 0 });
    const boosted = computeSlap({ attacker: 'bernard', defender: 'lola', charge: 60, speed: 1.4, angle: 0, extra: FIGHTERS.bernard.special.multiplier });
    expect(hit.kind).toBe('special');
    expect(hit.special).toEqual({ name: 'Le Battoir', hits: [boosted.damage] });
    expect(hit.damage).toBe(boosted.damage);
    expect(hit.damage).toBeGreaterThan(normal.damage);
    expect(m.rage.left).toBe(0);
    expect(m.specialReady.left).toBe(false);
  });

  it('La Toupie : 3 gifles à ×0,7', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.play(miss); // Bernard
    m.specialReady.right = true;
    m.rage.right = 100;
    const ev = m.play(slap); // Lola
    const hit = find(ev, 'hit')!;
    const each = computeSlap({ attacker: 'lola', defender: 'bernard', charge: 60, speed: 1.4, angle: 0, extra: 0.7 }).damage;
    expect(hit.special).toEqual({ name: 'La Toupie', hits: [each, each, each] });
    expect(hit.damage).toBe(3 * each);
    expect(m.hp.left).toBe(MATCH.hp - 3 * each);
    expect(m.rage.right).toBe(0);
  });

  it('une gifle molle ou une surchauffe ne gaspille pas la spéciale', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.specialReady.left = true;
    m.rage.left = 100;
    m.play({ type: 'timeout' });
    expect(m.specialReady.left).toBe(true);
    m.play(miss);
    m.play({ type: 'selfslap' });
    expect(m.specialReady.left).toBe(true);
  });
});

describe('état sonné', () => {
  it('un coup de 25 dégâts ou plus sonne la victime pour son prochain tour', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    const big = { type: 'slap', charge: 85, speed: 2.5, angle: 0 } as const; // critique de Bernard
    const ev = m.play(big);
    expect(find(ev, 'hit')!.damage).toBeGreaterThanOrEqual(ADVANCED.stunThreshold);
    expect(find(ev, 'stunned')).toEqual({ type: 'stunned', side: 'right' });
    expect(m.stunned.right).toBe(true);
    // Lola joue son tour sonnée, puis l'état disparaît.
    m.play(miss);
    expect(m.stunned.right).toBe(false);
  });

  it('un coup de moins de 25 ne sonne pas', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    const ev = m.play(slap);
    expect(find(ev, 'hit')!.damage).toBeLessThan(ADVANCED.stunThreshold);
    expect(find(ev, 'stunned')).toBeUndefined();
    expect(m.stunned.right).toBe(false);
  });

  it('la jauge d’un perso sonné monte de façon irrégulière, entre −30 % et +30 %', () => {
    const curve = stunCurve(createRng(5));
    const samples = Array.from({ length: 400 }, (_, i) => curve(i * 5));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(1 - ADVANCED.stunSpeedVariance - 1e-9);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1 + ADVANCED.stunSpeedVariance + 1e-9);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.25); // ça bouge vraiment
    // Pas de saut brutal entre deux instants proches (raccords en douceur).
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThan(0.1);
  });

  it('la charge suit la courbe : même appui, résultat différent de la normale', () => {
    const curve = stunCurve(createRng(11));
    const t = FIGHTERS.bernard.chargeTimeMs;
    const normal = chargeAt(700, t);
    const stunned = chargeAt(700, t, curve);
    expect(normal).toBe(50);
    expect(Math.abs(stunned - normal)).toBeGreaterThan(0.5);
    expect(stunned).toBeGreaterThan(50 * 0.7 - 1);
    expect(stunned).toBeLessThan(50 * 1.3 + 1);
    // Vitesse constante : on retombe sur la formule simple.
    expect(chargeAt(700, t, () => 1)).toBeCloseTo(50, 6);
    expect(timeToFull(t, () => 1)).toBeCloseTo(t, -1);
  });

  it('la surchauffe tient compte de la courbe', () => {
    const fast = () => 1.3;
    const t = FIGHTERS.lola.chargeTimeMs;
    expect(isOverheated(t / 1.3 + SLAP.overheatGraceMs + 20, t, fast)).toBe(true);
    expect(isOverheated(t / 1.3 + SLAP.overheatGraceMs + 20, t)).toBe(false);
  });

  it('le geste utilise la courbe du perso sonné', () => {
    const g = new SlapGesture('bernard', 1, () => 1.25);
    g.down(0, 100, 100);
    expect(g.charge(560)).toBeCloseTo(50, 0);
  });
});

describe('équilibre avec les mécaniques avancées (200 matchs simulés)', () => {
  const s = simulateMany(200, 2027);
  it('Bernard et Lola restent entre 40 et 60 % de victoires', () => {
    expect(s.winRate.bernard).toBeGreaterThanOrEqual(0.4);
    expect(s.winRate.bernard).toBeLessThanOrEqual(0.6);
  });
  it('les spéciales et l’état sonné apparaissent vraiment en match', () => {
    expect(s.specialsPerMatch).toBeGreaterThan(1);
    expect(s.stunsPerMatch).toBeGreaterThan(1);
  });
});
