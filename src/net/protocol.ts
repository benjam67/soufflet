// Protocole du jeu en ligne (pur, sans réseau) : code de salon, messages, synchronisation.
//
// Principe : un match est entièrement déterminé par la suite des actions jouées
// (charge, vitesse, angle de chaque gifle). Chaque téléphone joue ses propres tours et envoie
// l'action à l'autre ; les deux déroulent le même `Match`. Pour reprendre après une coupure
// ou un rechargement, il suffit de comparer les journaux d'actions et de rejouer ce qui manque.
import type { TurnAction } from '../logic/match';

export const PROTOCOL_VERSION = 1;

/** Lettres du code de salon : sans I ni O (trop proches de 1 et 0 quand on dicte le code). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;

export function makeCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

/** Nettoie un code saisi (minuscules, espaces) ; renvoie null s'il n'est pas valide. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** Identifiant PeerJS de l'hôte d'un salon. */
export const peerIdFor = (code: string) => `slap-fighter-v${PROTOCOL_VERSION}-${code}`;

export type Role = 'host' | 'guest';
/** L'hôte joue à gauche (Bernard), l'invité à droite (Lola). */
export const sideOf = (role: Role) => (role === 'host' ? 'left' : 'right') as 'left' | 'right';

export type NetMsg =
  /** Échangé à chaque (re)connexion : où en est chacun. */
  | { t: 'hello'; v: number; matchId: number; log: TurnAction[] }
  /** Action du tour n° `n` (0 = premier tour du match). */
  | { t: 'action'; matchId: number; n: number; action: TurnAction }
  /** Le joueur dont c'est le tour a posé le doigt / l'a levé sans gifler (pour l'animation en face). */
  | { t: 'press'; matchId: number; n: number }
  | { t: 'cancel'; matchId: number; n: number }
  | { t: 'rematch'; matchId: number }
  | { t: 'ping' };

export interface NetState {
  matchId: number;
  log: TurnAction[];
}

const sameAction = (a: TurnAction, b: TurnAction) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compare l'état local à celui reçu dans un `hello`.
 * - `adopt` : il faut repartir de l'état distant (match plus récent, ou journaux incompatibles et on n'est pas l'hôte).
 * - `missing` : actions que l'autre a déjà et qu'il nous manque (à rejouer chez nous).
 * - `ahead` : nombre d'actions que nous avons en plus (l'autre les rejouera de son côté).
 */
export function reconcile(local: NetState, remote: NetState, role: Role): { adopt: NetState | null; missing: TurnAction[]; ahead: number } {
  if (remote.matchId > local.matchId) return { adopt: { matchId: remote.matchId, log: [...remote.log] }, missing: [], ahead: 0 };
  if (remote.matchId < local.matchId) return { adopt: null, missing: [], ahead: local.log.length };
  const common = Math.min(local.log.length, remote.log.length);
  for (let i = 0; i < common; i++) {
    if (!sameAction(local.log[i], remote.log[i])) {
      // Journaux divergents (ne devrait pas arriver) : l'hôte fait foi.
      return role === 'host' ? { adopt: null, missing: [], ahead: local.log.length } : { adopt: { matchId: remote.matchId, log: [...remote.log] }, missing: [], ahead: 0 };
    }
  }
  return { adopt: null, missing: remote.log.slice(common), ahead: Math.max(0, local.log.length - common) };
}

/** Sauvegarde locale de la partie en ligne (survit à un rechargement de la page). */
export interface SavedSession extends NetState {
  code: string;
  role: Role;
}
const STORAGE_KEY = 'slap.online';

export function saveSession(s: SavedSession) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible */
  }
}

export function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    if (!normalizeCode(s.code) || (s.role !== 'host' && s.role !== 'guest') || !Array.isArray(s.log)) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* rien */
  }
}
