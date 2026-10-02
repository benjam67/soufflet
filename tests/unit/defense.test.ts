import { describe, expect, it } from 'vitest';
import { ADVANCED, COMBO, DEFENSE, MATCH, SLAP } from '../../src/config/balance';
import { aiDecide, aiDefend, AI_PROFILES } from '../../src/logic/ai';
import { DefenseGesture, SlapGesture } from '../../src/logic/gesture';
import { Match, replayMatch, type MatchEvent, type TurnAction } from '../../src/logic/match';
import { createRng } from '../../src/logic/rng';
import { simulateMany, simulateVs } from '../../src/logic/simulate';
import { computeSlap, judgeDefense } from '../../src/logic/slap';

const slap = { type: 'slap', charge: 60, speed: 1.4, angle: 0 } as const;
const weak = { type: 'slap', charge: 1, speed: 0.1, angle: 80 } as const; // 1 dégât
const big = { type: 'slap', charge: 85, speed: 2.5, angle: 0 } as const; // critique de Bernard
const find = <T extends MatchEvent['type']>(ev: MatchEvent[], t: T) => ev.find((e) => e.type === t) as Extract<MatchEvent, { type: T }> | undefined;
const types = (ev: MatchEvent[]) => ev.map((e) => e.type);

describe('esquive : jugement du swipe arrière', () => {
  it('parfaite tout près de l’impact, correcte un peu plus loin, rien au-delà', () => {
    expect(judgeDefense(1000, 1000)).toBe('perfect');
    expect(judgeDefense(1000 - DEFENSE.perfectWindowMs, 1000)).toBe('perfect');
    expect(judgeDefense(1000 - DEFENSE.perfectWindowMs - 1, 1000)).toBe('good');
    expect(judgeDefense(1000 - DEFENSE.goodWindowMs, 1000)).toBe('good');
    expect(judgeDefense(1000 - DEFENSE.goodWindowMs - 1, 1000)).toBeNull();
    expect(judgeDefense(null, 1000)).toBeNull();
  });

  it('réduit les dégâts de 30 % (correcte) ou 60 % (parfaite)', () => {
    const base = { attacker: 'bernard', defender: 'lola', charge: 85, speed: 2.5, angle: 0 } as const;
    const full = computeSlap(base);
    const good = computeSlap({ ...base, defense: 'good' });
    const perfect = computeSlap({ ...base, defense: 'perfect' });
    expect(good.damage).toBe(Math.round(full.raw * (1 - DEFENSE.reduction.good)));
    expect(perfect.damage).toBe(Math.round(full.raw * (1 - DEFENSE.reduction.perfect)));
    expect(perfect.avoided).toBe(full.damage - perfect.damage);
    expect(full.avoided).toBe(0);
  });

  it('en avance ou en retard : aucune pénalité, les dégâts sont ceux d’une gifle normale', () => {
    const m1 = new Match('bernard', 'lola');
    m1.startRound();
    const plain = find(m1.play(slap), 'hit')!.damage;
    // Une esquive mal placée n'est pas transmise : l'action est la même que sans esquive.
    expect(judgeDefense(400, 1000)).toBeNull();
    expect(computeSlap({ attacker: 'bernard', defender: 'lola', ...slap, defense: judgeDefense(400, 1000) }).damage).toBe(plain);
  });

  it('dans le match : dégâts réduits, esquive notée, +10 de rage pour une parfaite', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    const hit = find(m.play({ ...big, defense: 'perfect' }), 'hit')!;
    const full = computeSlap({ attacker: 'bernard', defender: 'lola', ...big }).damage;
    expect(hit.defense).toBe('perfect');
    expect(hit.damage).toBeLessThan(full);
    expect(hit.avoided).toBe(full - hit.damage);
    expect(m.rage.right).toBe(hit.damage + DEFENSE.perfectRageBonus);
  });

  it('adoucit l’état sonné : un gros coup esquivé passe sous le seuil', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    expect(find(m.play(big), 'stunned')).toBeDefined();
    const m2 = new Match('bernard', 'lola');
    m2.startRound();
    const ev = m2.play({ ...big, defense: 'perfect' });
    expect(find(ev, 'hit')!.damage).toBeLessThan(ADVANCED.stunThreshold);
    expect(find(ev, 'stunned')).toBeUndefined();
  });
});

describe('garde de rage', () => {
  it('rage pleine : esquive parfaite garantie, toute la rage est dépensée', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.rage.right = 100;
    m.specialReady.right = true;
    const hit = find(m.play({ ...big, rageGuard: true }), 'hit')!;
    expect(hit.defense).toBe('rage');
    expect(hit.damage).toBe(computeSlap({ attacker: 'bernard', defender: 'lola', ...big, defense: 'perfect' }).damage);
    expect(m.specialReady.right).toBe(false);
    expect(m.rage.right).toBe(hit.damage); // repart de 0, plus les dégâts reçus
  });

  it('sans rage pleine, la garde ne fait rien', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    const hit = find(m.play({ ...slap, rageGuard: true }), 'hit')!;
    expect(hit.defense).toBeUndefined();
    expect(hit.avoided).toBe(0);
  });
});

describe('geste d’esquive', () => {
  it('swipe vers l’arrière = esquive, daté au moment où il est reconnu', () => {
    const g = new DefenseGesture(1); // joueur de droite : l'arrière est vers la droite
    g.down(1, 0, 500, 200);
    expect(g.track(1, 20, 520, 200)).toBeNull();
    expect(g.track(1, 45, 500 + DEFENSE.minSwipePx, 202)).toEqual({ kind: 'dodge', at: 45 });
  });

  it('swipe vers le bas = garde de rage ; vers l’avant = rien', () => {
    const g = new DefenseGesture(-1);
    g.down(1, 0, 200, 100);
    expect(g.up(1, 60, 205, 100 + DEFENSE.minSwipePx)).toEqual({ kind: 'guard', at: 60 });
    const h = new DefenseGesture(-1); // joueur de gauche : avancer = vers la droite
    h.down(1, 0, 200, 100);
    expect(h.up(1, 60, 300, 100)).toBeNull();
  });

  it('un seul essai par gifle : le premier geste compte, les suivants sont ignorés', () => {
    const g = new DefenseGesture(1);
    g.down(1, 0, 500, 200);
    g.up(1, 50, 560, 200);
    g.down(2, 300, 500, 200);
    expect(g.up(2, 350, 560, 200)).toBeNull();
    expect(g.move).toEqual({ kind: 'dodge', at: 50 });
  });
});

describe('feinte', () => {
  const swipe = (g: SlapGesture) => {
    g.down(0, 100, 100);
    g.move(1100, 130, 100);
    g.move(1160, 100 + SLAP.minSwipePx + 60, 100);
  };

  it('le swipe fait, la gifle est armée tant que le doigt reste posé', () => {
    const g = new SlapGesture('bernard', 1);
    swipe(g);
    expect(g.armed).toBe(true);
    expect(g.update(1400)).toBeNull();
    const out = g.up(1500, 220, 100);
    expect(out?.type).toBe('slap');
    if (out?.type === 'slap') {
      expect(out.heldMs).toBe(340);
      // Vitesse et charge sont celles du swipe, pas de l'attente.
      expect(out.durationMs).toBeLessThan(100);
      expect(out.charge).toBeGreaterThan(70);
    }
  });

  it('retenue trop longtemps, la gifle part toute seule', () => {
    const g = new SlapGesture('bernard', 1);
    swipe(g);
    expect(g.update(1160 + DEFENSE.feintMaxMs)).toBeNull();
    const out = g.update(1160 + DEFENSE.feintMaxMs + 1);
    expect(out?.type).toBe('slap');
    expect(g.phase).toBe('done');
  });

  it('une gifle sans retenue a un temps de feinte nul', () => {
    const g = new SlapGesture('lola', 1);
    g.down(0, 100, 100);
    g.move(800, 130, 100);
    const out = g.up(860, 300, 100);
    expect(out?.type === 'slap' && out.heldMs).toBe(0);
  });
});

describe('droit de réponse', () => {
  it('celui qui ouvre met l’autre K.O. : l’autre rend une dernière gifle', () => {
    expect(MATCH.rightOfReply).toBe(true);
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.hp.right = 3;
    const ev = m.play(slap);
    expect(types(ev)).toEqual(['hit', 'lastWord', 'turn']);
    expect(m.phase).toBe('turn');
    expect(m.turn).toBe('right');
    expect(m.lastWord).toBe('right');
    expect(m.hp.right).toBe(0);
  });

  it('la réponse ne suffit pas : K.O. confirmé', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.hp.right = 3;
    m.play(slap);
    const ev = m.play(weak);
    expect(find(ev, 'ko')).toEqual({ type: 'ko', loser: 'right' });
    expect(m.wins).toEqual({ left: 1, right: 0 });
  });

  it('double K.O. : gagne celui qui est le moins « en dessous de zéro »', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.hp.right = 3; // Bernard tape fort : Lola très en dessous de zéro
    m.hp.left = 5;
    m.play(big);
    const ev = m.play(slap); // Lola répond et met Bernard K.O. de peu
    expect(m.hp).toEqual({ left: 0, right: 0 });
    expect(find(ev, 'ko')).toEqual({ type: 'ko', loser: 'right' });

    const m2 = new Match('bernard', 'lola');
    m2.startRound();
    m2.hp.right = 3;
    m2.hp.left = 2;
    m2.play({ type: 'slap', charge: 30, speed: 0.3, angle: 0 }); // de justesse
    const ev2 = m2.play(big); // réponse énorme
    expect(find(ev2, 'ko')).toEqual({ type: 'ko', loser: 'left' });
    expect(m2.wins).toEqual({ left: 0, right: 1 });
  });

  it('pas de réponse quand c’est celui qui n’a pas ouvert qui met K.O., ni après une surchauffe', () => {
    const m = new Match('bernard', 'lola');
    m.startRound();
    m.play(weak);
    m.hp.left = 2;
    expect(find(m.play(slap), 'lastWord')).toBeUndefined();
    expect(m.phase).toBe('roundOver');
  });

  it('une partie rejouée depuis son journal donne le même résultat (esquives comprises)', () => {
    const log: TurnAction[] = [];
    const rng = createRng(9);
    const m = new Match('bernard', 'lola');
    m.startRound();
    while (m.phase !== 'matchOver') {
      if (m.phase === 'roundOver') m.startRound();
      const d = aiDecide(rng, m.ids[m.turn], AI_PROFILES.average, 1, m.specialReady[m.turn]);
      if (d.action.type === 'slap') Object.assign(d.action, aiDefend(rng, AI_PROFILES.average, d.feintMs, false));
      log.push(d.action);
      m.play(d.action);
    }
    const r = replayMatch(JSON.parse(JSON.stringify(log)) as TurnAction[]);
    expect(r.winner).toBe(m.winner);
    expect(r.wins).toEqual(m.wins);
    expect(r.totalTurns).toBe(m.totalTurns);
  });
});

describe('IA : esquive, feinte, spéciales', () => {
  it('une vraie feinte fait mordre l’IA plus souvent', () => {
    const rng = createRng(3);
    const count = (feintMs: number) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) if (aiDefend(rng, AI_PROFILES.average, feintMs, false).defense) n++;
      return n / 2000;
    };
    const plain = count(30);
    const feinted = count(400);
    expect(plain).toBeCloseTo(0.5, 1);
    expect(feinted).toBeLessThan(plain * 0.7);
  });

  it('La Toupie de l’IA place 1 à 3 gifles ; Le Battoir toujours une', () => {
    const rng = createRng(4);
    const counts = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const d = aiDecide(rng, 'lola', AI_PROFILES.average, 1, true);
      if (d.action.type === 'slap') counts.add(d.action.special!.hits.length);
      const b = aiDecide(rng, 'bernard', AI_PROFILES.average, 1, true);
      if (b.action.type === 'slap') expect(b.action.special!.hits).toHaveLength(1);
    }
    expect([...counts].sort()).toEqual([1, 2, 3]);
    expect(COMBO.minGapMs).toBeLessThan(COMBO.maxGapMs);
  });
});

describe('le jeu est moins prévisible (600 matchs simulés)', () => {
  const s = simulateMany(600, 77);
  it('celui qui ouvre la manche ne la gagne plus qu’une fois sur deux environ', () => {
    expect(s.openerWinRate).toBeGreaterThan(0.43);
    expect(s.openerWinRate).toBeLessThan(0.56);
  });
  it('les esquives comptent vraiment, sans tout bloquer', () => {
    expect(s.dodgeRate).toBeGreaterThan(0.25);
    expect(s.dodgeRate).toBeLessThan(0.6);
  });
  it('un match dure toujours entre 60 et 180 secondes en moyenne', () => {
    expect(s.avgSeconds).toBeGreaterThan(60);
    expect(s.avgSeconds).toBeLessThan(180);
  });
  it('niveaux de l’IA : facile ~30 %, difficile ~60 % contre le joueur moyen', () => {
    const easy = simulateVs(800, AI_PROFILES.easy, AI_PROFILES.average, 5).winRateA;
    const hard = simulateVs(800, AI_PROFILES.hard, AI_PROFILES.average, 5).winRateA;
    expect(easy).toBeGreaterThan(0.22);
    expect(easy).toBeLessThan(0.4);
    expect(hard).toBeGreaterThan(0.54);
    expect(hard).toBeLessThan(0.72);
  });
});
