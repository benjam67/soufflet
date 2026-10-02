// Progression du joueur : expérience, niveaux, déblocages, préférences. Pur (le stockage est injecté).
import type { FighterId } from '../config/balance';
import { PROGRESS, UNLOCKS, type Unlock } from '../config/progress';

export interface Progress {
  v: 1;
  xp: number;
  matches: number;
  wins: number;
  /** Perso choisi en solo et à l'entraînement. */
  fighter: FighterId;
  /** Tenue portée par chaque perso et bar choisi (identifiants de `UNLOCKS`, ou 'base'). */
  skin: Record<FighterId, string>;
  bar: string;
}

export const newProgress = (): Progress => ({ v: 1, xp: 0, matches: 0, wins: 0, fighter: 'bernard', skin: { bernard: 'base', lola: 'base' }, bar: 'base' });

/** XP cumulée nécessaire pour atteindre le niveau `n` (niveau 1 = 0). Paliers : 100, 250, 450, 700… */
export const xpForLevel = (n: number) => (PROGRESS.levelStep / 4) * (n - 1) * (n + 2);

export function levelOf(xp: number): number {
  let n = 1;
  while (n < PROGRESS.maxLevel && xp >= xpForLevel(n + 1)) n++;
  return n;
}

/** Avancement dans le niveau en cours, de 0 à 1 (1 au niveau maximal). */
export function levelProgress(xp: number): number {
  const n = levelOf(xp);
  if (n >= PROGRESS.maxLevel) return 1;
  return (xp - xpForLevel(n)) / (xpForLevel(n + 1) - xpForLevel(n));
}

export type MatchKind = 'solo' | 'match' | 'online';
export interface MatchOutcome {
  kind: MatchKind;
  /** Niveau de l'IA (solo). */
  level?: 'easy' | 'normal' | 'hard';
  /** Le joueur a-t-il gagné ? (À deux sur le même téléphone : toujours vrai, il y a un gagnant.) */
  won: boolean;
  /** Rounds gagnés par le joueur. */
  rounds: number;
}

/** XP gagnée pour un match terminé. */
export function xpFor(o: MatchOutcome): number {
  const x = PROGRESS.xp;
  if (o.kind === 'match') return x.local;
  const win = o.kind === 'online' ? x.winOnline : x.winSolo[o.level ?? 'normal'];
  return x.played + o.rounds * x.perRound + (o.won ? win : 0);
}

export const unlockedAt = (level: number): Unlock[] => UNLOCKS.filter((u) => u.level <= level);
export const isUnlocked = (id: string, xp: number) => id === 'base' || UNLOCKS.some((u) => u.id === id && u.level <= levelOf(xp));

export interface Award {
  gained: number;
  before: number;
  after: number;
  levelBefore: number;
  levelAfter: number;
  /** Ce que ce match vient de débloquer. */
  unlocked: Unlock[];
}

/** Ajoute le résultat d'un match à la progression (modifie `p`) et dit ce qui a été gagné. */
export function award(p: Progress, o: MatchOutcome): Award {
  const gained = xpFor(o);
  const before = p.xp;
  const levelBefore = levelOf(before);
  p.xp += gained;
  p.matches++;
  if (o.won && o.kind !== 'match') p.wins++;
  const levelAfter = levelOf(p.xp);
  return { gained, before, after: p.xp, levelBefore, levelAfter, unlocked: UNLOCKS.filter((u) => u.level > levelBefore && u.level <= levelAfter) };
}

/** Choix possibles pour une tenue ou un bar : 'base' puis ce qui est débloqué. */
export function choices(kind: 'skin' | 'bar', xp: number, fighter?: FighterId): string[] {
  return ['base', ...unlockedAt(levelOf(xp)).filter((u) => u.kind === kind && (kind === 'bar' || u.fighter === fighter)).map((u) => u.id)];
}

/** Passe au choix suivant (boucle). */
export function nextChoice(list: string[], current: string): string {
  return list[(list.indexOf(current) + 1) % list.length] ?? 'base';
}

/** Prochain déblocage à venir, s'il en reste. */
export const nextUnlock = (xp: number): Unlock | null => UNLOCKS.filter((u) => u.level > levelOf(xp)).sort((a, b) => a.level - b.level)[0] ?? null;

/** Teinte d'une tenue ou d'un bar (blanc = dessin d'origine). */
export const tintOf = (id: string): number => UNLOCKS.find((u) => u.id === id)?.tint ?? 0xffffff;
export const nameOf = (id: string): string => UNLOCKS.find((u) => u.id === id)?.name ?? 'Classique';

/** Remet d'aplomb une sauvegarde lue (abîmée, ancienne, ou choix qui ne sont plus débloqués). */
export function sanitize(raw: unknown): Progress {
  const p = newProgress();
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Partial<Progress>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  p.xp = num(r.xp);
  p.matches = num(r.matches);
  p.wins = num(r.wins);
  if (r.fighter === 'lola' || r.fighter === 'bernard') p.fighter = r.fighter;
  for (const f of ['bernard', 'lola'] as const) {
    const id = r.skin?.[f];
    if (typeof id === 'string' && choices('skin', p.xp, f).includes(id)) p.skin[f] = id;
  }
  if (typeof r.bar === 'string' && choices('bar', p.xp).includes(r.bar)) p.bar = r.bar;
  return p;
}

const KEY = 'slap.progress';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export function loadProgress(store: Store | null = defaultStore()): Progress {
  try {
    const raw = store?.getItem(KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return newProgress();
  }
}

export function saveProgress(p: Progress, store: Store | null = defaultStore()) {
  try {
    store?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* stockage indisponible : la progression vit le temps de la session */
  }
}
