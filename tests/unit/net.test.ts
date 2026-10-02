import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, makeCode, normalizeCode, peerIdFor, reconcile, sideOf } from '../../src/net/protocol';
import { Match, replayMatch, type TurnAction } from '../../src/logic/match';
import { createRng } from '../../src/logic/rng';
import { aiDecide, AI_PROFILES } from '../../src/logic/ai';

const A: TurnAction = { type: 'slap', charge: 60, speed: 1.4, angle: 3 };
const B: TurnAction = { type: 'timeout' };
const C: TurnAction = { type: 'selfslap' };

describe('code de salon', () => {
  it('fait 4 lettres, sans I ni O', () => {
    const rng = createRng(1);
    for (let i = 0; i < 500; i++) {
      const c = makeCode(rng);
      expect(c).toMatch(/^[A-Z]{4}$/);
      expect(c).not.toMatch(/[IO]/);
      expect(normalizeCode(c)).toBe(c);
    }
    expect(CODE_ALPHABET).toHaveLength(24);
  });

  it('accepte les minuscules et les espaces, refuse le reste', () => {
    expect(normalizeCode(' ab cd ')).toBe('ABCD');
    expect(normalizeCode('a-b-c-d')).toBe('ABCD');
    expect(normalizeCode('ABC')).toBeNull();
    expect(normalizeCode('ABCDE')).toBeNull();
    expect(normalizeCode('ABIO')).toBeNull();
    expect(normalizeCode('1234')).toBeNull();
  });

  it('donne un identifiant de salon stable, hôte à gauche et invité à droite', () => {
    expect(peerIdFor('ABCD')).toBe('slap-fighter-v2-ABCD');
    expect(sideOf('host')).toBe('left');
    expect(sideOf('guest')).toBe('right');
  });
});

describe('synchronisation des journaux', () => {
  it('rien à faire quand les deux sont au même point', () => {
    expect(reconcile({ matchId: 1, log: [A, B] }, { matchId: 1, log: [A, B] }, 'guest')).toEqual({ adopt: null, missing: [], ahead: 0 });
  });

  it('rattrape les actions manquantes (message perdu pendant la coupure)', () => {
    const r = reconcile({ matchId: 1, log: [A] }, { matchId: 1, log: [A, B, C] }, 'host');
    expect(r).toEqual({ adopt: null, missing: [B, C], ahead: 0 });
  });

  it('sait quand on est en avance : c’est l’autre qui rattrapera', () => {
    expect(reconcile({ matchId: 1, log: [A, B] }, { matchId: 1, log: [A] }, 'guest')).toEqual({ adopt: null, missing: [], ahead: 1 });
  });

  it('adopte le match le plus récent (revanche lancée en face)', () => {
    const r = reconcile({ matchId: 1, log: [A, B] }, { matchId: 2, log: [C] }, 'host');
    expect(r.adopt).toEqual({ matchId: 2, log: [C] });
  });

  it('journaux divergents : l’hôte fait foi', () => {
    expect(reconcile({ matchId: 1, log: [A] }, { matchId: 1, log: [B] }, 'guest').adopt).toEqual({ matchId: 1, log: [B] });
    expect(reconcile({ matchId: 1, log: [A] }, { matchId: 1, log: [B] }, 'host').adopt).toBeNull();
  });
});

describe('reprise d’un match par son journal', () => {
  it('rejouer le journal redonne exactement le même match (PV, rage, rounds, tour)', () => {
    // On joue un match complet IA contre IA en notant les actions…
    const rng = createRng(77);
    const live = new Match('bernard', 'lola');
    const log: TurnAction[] = [];
    live.startRound();
    while (live.phase !== 'matchOver') {
      if (live.phase === 'roundOver') live.startRound();
      const action = aiDecide(rng, live.ids[live.turn], AI_PROFILES.average).action;
      log.push(action);
      live.play(action);
      // …et régulièrement, la reprise doit retomber exactement sur le même état.
      if (log.length % 3 === 0 && live.phase === 'turn') {
        const again = replayMatch(log);
        expect(again.round).toBe(live.round);
        expect(again.wins).toEqual(live.wins);
        expect(again.hp).toEqual(live.hp);
        expect(again.turn).toBe(live.turn);
        expect(again.rage).toEqual(live.rage);
        expect(again.specialReady).toEqual(live.specialReady);
        expect(again.stunned).toEqual(live.stunned);
      }
    }
    const end = replayMatch(log);
    expect(end.phase).toBe('matchOver');
    expect(end.winner).toBe(live.winner);
    expect(end.wins).toEqual(live.wins);
    expect(end.totalTurns).toBe(log.length);
  });

  it('journal vide : début du round 1, à gauche de jouer', () => {
    const m = replayMatch([]);
    expect(m.round).toBe(1);
    expect(m.turn).toBe('left');
    expect(m.hp).toEqual({ left: 100, right: 100 });
  });

  it('enchaîne tout seul sur le round suivant après un K.O.', () => {
    const big: TurnAction = { type: 'slap', charge: 85, speed: 2.5, angle: 0 };
    const tiny: TurnAction = { type: 'slap', charge: 1, speed: 0.1, angle: 80 };
    const log: TurnAction[] = [];
    const m = new Match('bernard', 'lola');
    m.startRound();
    while (m.phase === 'turn') {
      const a = m.turn === 'left' ? big : tiny;
      log.push(a);
      m.play(a);
    }
    const again = replayMatch(log);
    expect(again.round).toBe(2);
    expect(again.wins).toEqual({ left: 1, right: 0 });
    expect(again.phase).toBe('turn');
    expect(again.turn).toBe('right'); // le perdant du round commence
  });
});
