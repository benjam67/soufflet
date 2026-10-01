// Simulation de matchs complets sans affichage (IA contre IA).
import type { FighterId } from '../config/balance';
import { aiDecide, AI_PROFILES, type AiProfile } from './ai';
import { Match, type Side } from './match';
import { createRng, type Rng } from './rng';
import { stunCurve } from './slap';

/** Durée d'animation d'un tour à l'écran (bandeau + gifle + réaction), en ms. */
export const TURN_OVERHEAD_MS = 1300;
/** Annonces de round (ROUND N, BAGARRE !, K.O.), en ms. */
export const ROUND_OVERHEAD_MS = 4000;

export interface SimResult {
  winner: Side;
  winnerId: FighterId;
  rounds: number;
  turns: number;
  /** Durée estimée du match à l'écran, en secondes. */
  seconds: number;
  crits: number;
  selfSlaps: number;
  timeouts: number;
  specials: number;
  stuns: number;
}

export function simulateMatch(
  rng: Rng,
  ids: Record<Side, FighterId>,
  profiles: Record<Side, AiProfile> = { left: AI_PROFILES.average, right: AI_PROFILES.average },
  first: Side = 'left',
  maxTurns = 5000,
): SimResult {
  const m = new Match(ids.left, ids.right, first);
  let ms = 0;
  let crits = 0;
  let selfSlaps = 0;
  let timeouts = 0;
  let specials = 0;
  let stuns = 0;
  m.startRound();
  ms += ROUND_OVERHEAD_MS;
  while (m.phase !== 'matchOver') {
    if (m.totalTurns > maxTurns) throw new Error('Match sans fin');
    if (m.phase === 'roundOver') {
      m.startRound();
      ms += ROUND_OVERHEAD_MS;
      continue;
    }
    const side = m.turn;
    const d = aiDecide(rng, m.ids[side], profiles[side], m.stunned[side] ? stunCurve(rng) : 1);
    ms += d.startDelayMs + d.holdMs + d.swipeMs + TURN_OVERHEAD_MS;
    for (const e of m.play(d.action)) {
      if (e.type === 'hit' && e.result?.critical) crits++;
      if (e.type === 'hit' && e.kind === 'special') specials++;
      if (e.type === 'stunned') stuns++;
      if (e.type === 'selfhit') selfSlaps++;
      if (e.type === 'hit' && e.kind === 'limp') timeouts++;
    }
  }
  const winner = m.winner!;
  return {
    winner,
    winnerId: m.ids[winner],
    rounds: m.round,
    turns: m.totalTurns,
    seconds: ms / 1000,
    crits,
    selfSlaps,
    timeouts,
    specials,
    stuns,
  };
}

export interface SimSummary {
  matches: number;
  winRate: Record<FighterId, number>;
  avgSeconds: number;
  avgTurns: number;
  avgRounds: number;
  critRate: number;
  selfSlapRate: number;
  timeoutRate: number;
  specialsPerMatch: number;
  stunsPerMatch: number;
}

/**
 * Lance `n` matchs Bernard contre Lola, en alternant les côtés et qui commence,
 * pour mesurer l'équilibre des persos sans biais de position.
 */
export function simulateMany(n: number, seed = 1, profile: AiProfile = AI_PROFILES.average): SimSummary {
  const rng = createRng(seed);
  const wins: Record<FighterId, number> = { bernard: 0, lola: 0 };
  let seconds = 0;
  let turns = 0;
  let rounds = 0;
  let crits = 0;
  let selfSlaps = 0;
  let timeouts = 0;
  let specials = 0;
  let stuns = 0;
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1;
    const ids: Record<Side, FighterId> = swap ? { left: 'lola', right: 'bernard' } : { left: 'bernard', right: 'lola' };
    const first: Side = Math.floor(i / 2) % 2 === 0 ? 'left' : 'right';
    const r = simulateMatch(rng, ids, { left: profile, right: profile }, first);
    wins[r.winnerId]++;
    seconds += r.seconds;
    turns += r.turns;
    rounds += r.rounds;
    crits += r.crits;
    selfSlaps += r.selfSlaps;
    timeouts += r.timeouts;
    specials += r.specials;
    stuns += r.stuns;
  }
  return {
    matches: n,
    winRate: { bernard: wins.bernard / n, lola: wins.lola / n },
    avgSeconds: seconds / n,
    avgTurns: turns / n,
    avgRounds: rounds / n,
    critRate: crits / turns,
    selfSlapRate: selfSlaps / turns,
    timeoutRate: timeouts / turns,
    specialsPerMatch: specials / n,
    stunsPerMatch: stuns / n,
  };
}

/**
 * Lance `n` matchs profil A contre profil B, en alternant persos, côtés et qui commence.
 * Renvoie la part de victoires de A.
 */
export function simulateVs(n: number, a: AiProfile, b: AiProfile, seed = 1): { winRateA: number; avgSeconds: number } {
  const rng = createRng(seed);
  let winsA = 0;
  let seconds = 0;
  for (let i = 0; i < n; i++) {
    const aSide: Side = i % 2 === 0 ? 'left' : 'right';
    const bSide: Side = aSide === 'left' ? 'right' : 'left';
    const aId: FighterId = Math.floor(i / 2) % 2 === 0 ? 'bernard' : 'lola';
    const bId: FighterId = aId === 'bernard' ? 'lola' : 'bernard';
    const ids = { [aSide]: aId, [bSide]: bId } as Record<Side, FighterId>;
    const profiles = { [aSide]: a, [bSide]: b } as Record<Side, AiProfile>;
    const first: Side = Math.floor(i / 4) % 2 === 0 ? 'left' : 'right';
    const r = simulateMatch(rng, ids, profiles, first);
    if (r.winner === aSide) winsA++;
    seconds += r.seconds;
  }
  return { winRateA: winsA / n, avgSeconds: seconds / n };
}
