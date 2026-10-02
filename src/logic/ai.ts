// IA : joue avec les mêmes règles que le joueur, en simulant un humain.
// L'erreur de timing est en millisecondes (comme un réflexe), pas en % :
// une jauge plus rapide rend la zone dorée plus difficile à attraper.
import { FIGHTERS, MATCH, SLAP, type FighterId } from '../config/balance';
import type { DefenseQuality } from './slap';
import { chargeAt, isOverheated, timeToFull, type ChargeSpeed } from './slap';
import { gaussian, uniform, type Rng } from './rng';
import type { TurnAction } from './match';

export interface AiProfile {
  label: string;
  /** Écart type de l'erreur de relâchement autour du centre de la zone dorée (ms). */
  timingSdMs: number;
  /** Décalage moyen du relâchement (ms) : positif = trop tard. */
  timingBiasMs: number;
  /** Vitesse du swipe (px/ms) : moyenne et écart type. */
  speedMean: number;
  speedSd: number;
  /** Écart type de l'angle du swipe (degrés). */
  angleSdDeg: number;
  /** Délai avant de poser le doigt (ms). */
  reactionMs: [number, number];
  /** Durée du swipe lui-même (ms). */
  swipeMs: [number, number];
  /** Probabilité de feinter (retenir sa gifle avant de frapper). */
  feintProb: number;
  /** Esquive : chances d'une esquive parfaite / correcte, et de mordre à une feinte. */
  defense: { perfect: number; good: number; baited: number };
  /** La Toupie : chance de tenir le rythme pour chaque gifle supplémentaire. */
  comboSkill: number;
  /** Rage pleine en défense : chance de la dépenser en garde plutôt que de garder sa spéciale. */
  rageGuardProb: number;
}

const AVERAGE: AiProfile = {
  label: 'Joueur moyen',
  timingSdMs: 110,
  timingBiasMs: 0,
  speedMean: 1.5,
  speedSd: 0.5,
  angleSdDeg: 14,
  reactionMs: [350, 900],
  swipeMs: [90, 220],
  feintProb: 0.25,
  defense: { perfect: 0.15, good: 0.35, baited: 0.45 },
  comboSkill: 0.8,
  rageGuardProb: 0.2,
};

/**
 * Profils d'IA. Les écarts paraissent petits mais un match compte ~32 gifles :
 * calibrés par simulation (3 × 1500 matchs contre le joueur moyen, persos et côtés alternés).
 */
export const AI_PROFILES = {
  /** Référence de l'équilibrage (et de la démo IA contre IA). */
  average: AVERAGE,
  /** Moins précis, esquive moins bien, mord aux feintes, feinte peu : gagne ~30 % contre le joueur moyen. */
  easy: {
    ...AVERAGE,
    label: 'Facile',
    timingSdMs: 122,
    speedMean: 1.45,
    defense: { perfect: 0.12, good: 0.32, baited: 0.55 },
    feintProb: 0.12,
    comboSkill: 0.7,
  },
  /** Esquive mieux, se laisse moins feinter, feinte plus souvent : gagne ~62 % contre le joueur moyen. */
  hard: {
    ...AVERAGE,
    label: 'Difficile',
    defense: { perfect: 0.19, good: 0.37, baited: 0.35 },
    feintProb: 0.3,
    comboSkill: 0.88,
  },
} satisfies Record<string, AiProfile>;

export type AiLevel = 'easy' | 'normal' | 'hard';
/** Niveau de jeu du mode solo → profil d'IA (le niveau « normal » est le joueur moyen). */
export const LEVEL_PROFILE: Record<AiLevel, AiProfile> = {
  easy: AI_PROFILES.easy,
  normal: AI_PROFILES.average,
  hard: AI_PROFILES.hard,
};
export const LEVEL_LABEL: Record<AiLevel, string> = { easy: 'FACILE', normal: 'NORMAL', hard: 'DIFFICILE' };

export interface AiDecision {
  action: TurnAction;
  /** Feinte : temps pendant lequel la gifle est retenue avant de partir (ms). */
  feintMs: number;
  /** Délai avant l'appui, durée d'appui et durée du swipe (pour l'animer à l'écran). */
  startDelayMs: number;
  holdMs: number;
  swipeMs: number;
}

/** Multiplie une vitesse de jauge (nombre ou courbe) par un facteur. */
export function scaleSpeed(speed: ChargeSpeed, k: number): ChargeSpeed {
  return typeof speed === 'number' ? speed * k : (ms: number) => speed(ms) * k;
}

/**
 * Décide d'un tour complet pour `fighter`. Si la jauge est irrégulière (perso sonné),
 * l'IA vise comme d'habitude sans connaître la courbe : comme un joueur, elle se fait piéger.
 * `useSpecial` : la rage est pleine et l'IA lance sa spéciale (jauge et zone dorée de la spéciale).
 */
export function aiDecide(rng: Rng, fighter: FighterId, profile: AiProfile, chargeSpeed: ChargeSpeed = 1, useSpecial = false): AiDecision {
  const f = FIGHTERS[fighter];
  const sp = useSpecial ? f.special : null;
  const speedNow = sp?.chargeSpeed ? scaleSpeed(chargeSpeed, sp.chargeSpeed) : chargeSpeed;
  const zone = sp?.goldenZone ?? f.goldenZone;
  const tFull = timeToFull(f.chargeTimeMs, speedNow);
  const center = (zone[0] + zone[1]) / 2;
  // L'IA connaît la vitesse de la spéciale, pas les à-coups d'une jauge sonnée.
  const aim = ((center / 100) * f.chargeTimeMs) / (sp?.chargeSpeed ?? 1);
  const holdMs = Math.max(60, aim + profile.timingBiasMs + gaussian(rng, 0, profile.timingSdMs));
  const startDelayMs = uniform(rng, profile.reactionMs[0], profile.reactionMs[1]);
  const swipeMs = uniform(rng, profile.swipeMs[0], profile.swipeMs[1]);
  const feintMs = rng() < profile.feintProb ? uniform(rng, 200, 650) : uniform(rng, 10, 60);

  if (startDelayMs + Math.min(holdMs, tFull + SLAP.overheatGraceMs) + swipeMs > MATCH.turnTimeMs) {
    return { action: { type: 'timeout' }, startDelayMs, holdMs, swipeMs, feintMs: 0 };
  }
  if (isOverheated(holdMs, f.chargeTimeMs, speedNow)) {
    return { action: { type: 'selfslap' }, startDelayMs, holdMs: tFull + SLAP.overheatGraceMs + 1, swipeMs: 0, feintMs: 0 };
  }
  const charge = chargeAt(holdMs, f.chargeTimeMs, speedNow);
  const swing = () => ({
    speed: Math.min(4, Math.max(0.15, gaussian(rng, profile.speedMean, profile.speedSd))),
    angle: Math.min(80, Math.abs(gaussian(rng, 0, profile.angleSdDeg))),
  });
  const first = swing();
  const action: TurnAction = { type: 'slap', charge, ...first };
  if (sp) {
    // La Toupie : chaque gifle supplémentaire demande de tenir le rythme.
    const hits = [first];
    while (hits.length < sp.hits && rng() < profile.comboSkill) hits.push(swing());
    action.special = { hits };
  }
  return { action, startDelayMs, holdMs, swipeMs, feintMs };
}

/** Esquive de l'IA face à une gifle (éventuellement feintée). */
export function aiDefend(rng: Rng, profile: AiProfile, feintMs: number, rageFull: boolean): { defense?: DefenseQuality; rageGuard?: boolean } {
  if (rageFull && rng() < profile.rageGuardProb) return { rageGuard: true };
  // Une vraie feinte fait partir l'esquive trop tôt.
  if (feintMs >= 150 && rng() < profile.defense.baited) return {};
  const r = rng();
  if (r < profile.defense.perfect) return { defense: 'perfect' };
  if (r < profile.defense.perfect + profile.defense.good) return { defense: 'good' };
  return {};
}
