import { describe, expect, it } from 'vitest';
import { Match, type MatchEvent } from '../../src/logic/match';
import { MATCH, SLAP } from '../../src/config/balance';
import { simulateMany, simulateMatch } from '../../src/logic/simulate';
import { createRng } from '../../src/logic/rng';
import { aiDecide, AI_PROFILES } from '../../src/logic/ai';

const strong = { type: 'slap', charge: 85, speed: 2.5, angle: 0 } as const; // critique
const weak = { type: 'slap', charge: 30, speed: 1, angle: 0 } as const;

const types = (ev: MatchEvent[]) => ev.map((e) => e.type);

/** Bernard (gauche) enchaîne les critiques, Lola rate exprès, jusqu'au K.O. */
function winRound(m: Match, winner: 'left' | 'right') {
  let guard = 0;
  while (m.phase === 'turn' && guard++ < 200) m.play(m.turn === winner ? strong : { type: 'slap', charge: 1, speed: 0.1, angle: 80 });
}

describe('match : déroulé des tours', () => {
  it('démarre le round 1 à 100 PV, Bernard (gauche) commence', () => {
    const m = new Match('bernard', 'lola');
    const ev = m.startRound();
    expect(ev).toEqual([
      { type: 'roundStart', round: 1, first: 'left' },
      { type: 'turn', side: 'left' },
    ]);
    expect(m.hp).toEqual({ left: MATCH.hp, right: MATCH.hp });
    expect(m.phase).toBe('turn');
  });

  it('une gifle blesse l’adversaire puis le tour passe', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    const ev = m.play(weak);
    expect(types(ev)).toEqual(['hit', 'turn']);
    const hit = ev[0] as Extract<MatchEvent, { type: 'hit' }>;
    expect(hit.attacker).toBe('left');
    expect(m.hp.right).toBe(MATCH.hp - hit.damage);
    expect(m.hp.left).toBe(MATCH.hp);
    expect(m.turn).toBe('right');
  });

  it('chrono dépassé : gifle molle automatique de 5 dégâts', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    const ev = m.play({ type: 'timeout' });
    expect(ev[0]).toMatchObject({ type: 'hit', kind: 'limp', damage: MATCH.limpSlapDamage, defender: 'right' });
    expect(m.hp.right).toBe(MATCH.hp - 5);
    expect(m.turn).toBe('right');
  });

  it('surchauffe : 8 dégâts sur soi et le tour passe', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    const ev = m.play({ type: 'selfslap' });
    expect(ev[0]).toEqual({ type: 'selfhit', side: 'left', damage: SLAP.selfSlapDamage });
    expect(m.hp.left).toBe(MATCH.hp - 8);
    expect(m.turn).toBe('right');
  });

  it('les tours alternent strictement', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    const seen = [m.turn];
    for (let i = 0; i < 6; i++) {
      m.play(weak);
      seen.push(m.turn);
    }
    expect(seen).toEqual(['left', 'right', 'left', 'right', 'left', 'right', 'left']);
  });
});

describe('match : rounds et victoire', () => {
  it('K.O. à 0 PV : fin du round, le vainqueur marque', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.hp.right = 3;
    const ev = m.play(weak);
    expect(types(ev)).toEqual(['hit', 'ko', 'roundOver']);
    expect(ev[1]).toEqual({ type: 'ko', loser: 'right' });
    expect(ev[2]).toMatchObject({ type: 'roundOver', round: 1, winner: 'left', wins: { left: 1, right: 0 } });
    expect(m.hp.right).toBe(0);
    expect(m.phase).toBe('roundOver');
    // Plus aucune action tant que le round suivant n'a pas commencé.
    expect(m.play(weak)).toEqual([]);
  });

  it('le perdant du round commence le suivant, PV remis à 100', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    winRound(m, 'left');
    const ev = m.startRound();
    expect(ev[0]).toEqual({ type: 'roundStart', round: 2, first: 'right' });
    expect(m.hp).toEqual({ left: 100, right: 100 });
    expect(m.turn).toBe('right');
  });

  it('2 rounds gagnants : victoire 2–0 dès le round 2', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    winRound(m, 'left');
    m.startRound();
    winRound(m, 'left');
    expect(m.phase).toBe('matchOver');
    expect(m.winner).toBe('left');
    expect(m.round).toBe(2);
    expect(m.startRound()).toEqual([]);
  });

  it('1–1 : le round 3 décide', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    winRound(m, 'left');
    m.startRound();
    winRound(m, 'right');
    expect(m.wins).toEqual({ left: 1, right: 1 });
    expect(m.phase).toBe('roundOver');
    m.startRound();
    winRound(m, 'right');
    expect(m.phase).toBe('matchOver');
    expect(m.winner).toBe('right');
    expect(m.round).toBe(3);
  });

  it('se mettre K.O. tout seul par surchauffe donne le round à l’adversaire', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.hp.left = 5;
    const ev = m.play({ type: 'selfslap' });
    expect(ev).toContainEqual({ type: 'ko', loser: 'left' });
    expect(m.wins).toEqual({ left: 0, right: 1 });
  });
});

describe('IA', () => {
  it('est reproductible avec la même graine', () => {
    const a = aiDecide(createRng(42), 'bernard', AI_PROFILES.average);
    const b = aiDecide(createRng(42), 'bernard', AI_PROFILES.average);
    expect(a).toEqual(b);
  });

  it('vise la zone dorée : environ la moitié de critiques pour un joueur moyen', () => {
    const rng = createRng(7);
    for (const id of ['bernard', 'lola'] as const) {
      let golden = 0;
      for (let i = 0; i < 2000; i++) {
        const d = aiDecide(rng, id, AI_PROFILES.average);
        if (d.action.type === 'slap') {
          const c = d.action.charge;
          const z = id === 'bernard' ? [80, 90] : [76, 92];
          if (c >= z[0] && c <= z[1]) golden++;
        }
      }
      expect(golden / 2000).toBeGreaterThan(0.35);
      expect(golden / 2000).toBeLessThan(0.7);
    }
  });
});

describe('simulation de 200 matchs (IA contre IA)', () => {
  const N = 200;
  const s = simulateMany(N, 2026);

  it('chaque match se termine (aucune boucle infinie, aucune erreur)', () => {
    const rng = createRng(99);
    for (let i = 0; i < N; i++) {
      const r = simulateMatch(rng, { left: 'bernard', right: 'lola' }, undefined, i % 2 ? 'right' : 'left');
      expect(['left', 'right']).toContain(r.winner);
      expect(r.rounds).toBeGreaterThanOrEqual(2);
      expect(r.rounds).toBeLessThanOrEqual(MATCH.maxRounds);
    }
  });

  it('équilibre Bernard / Lola entre 40 et 60 % de victoires', () => {
    expect(s.winRate.bernard).toBeGreaterThanOrEqual(0.4);
    expect(s.winRate.bernard).toBeLessThanOrEqual(0.6);
    expect(s.winRate.lola).toBeGreaterThanOrEqual(0.4);
    expect(s.winRate.lola).toBeLessThanOrEqual(0.6);
  });

  it('durée moyenne raisonnable (entre 45 s et 3 min)', () => {
    expect(s.avgSeconds).toBeGreaterThan(45);
    expect(s.avgSeconds).toBeLessThan(180);
  });
});
