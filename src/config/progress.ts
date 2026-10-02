// Réglages de la progression : expérience, niveaux, déblocages.
import type { FighterId } from './balance';

export const PROGRESS = {
  /** Écart d'XP entre les niveaux 1 et 2 ; chaque niveau suivant demande 50 de plus (100, 150, 200…). */
  levelStep: 100,
  maxLevel: 10,
  xp: {
    /** Match terminé (solo ou en ligne), gagné ou perdu. */
    played: 15,
    /** Par round gagné. */
    perRound: 10,
    /** Victoire contre l'IA, selon le niveau. */
    winSolo: { easy: 30, normal: 55, hard: 90 },
    winOnline: 60,
    /** Match à deux sur le même téléphone. */
    local: 20,
  },
};

export interface Unlock {
  id: string;
  kind: 'skin' | 'bar';
  fighter?: FighterId;
  name: string;
  /** Niveau du joueur qui le débloque. */
  level: number;
  /**
   * En attendant les vrais dessins (tenue streetwear, nouveaux bars), un déblocage est une
   * teinte appliquée au perso ou au décor. Il suffira de remplacer la teinte par les images.
   */
  tint: number;
}

export const UNLOCKS: Unlock[] = [
  { id: 'bernard_street', kind: 'skin', fighter: 'bernard', name: 'Streetwear', level: 2, tint: 0xa9c4ff },
  { id: 'bar_night', kind: 'bar', name: 'Bar de nuit', level: 3, tint: 0x8fa8ff },
  { id: 'lola_neon', kind: 'skin', fighter: 'lola', name: 'Néon', level: 4, tint: 0xb8ffc9 },
  { id: 'bar_sunset', kind: 'bar', name: 'Bar au couchant', level: 5, tint: 0xffbf94 },
  { id: 'bernard_bronze', kind: 'skin', fighter: 'bernard', name: 'Bronze', level: 6, tint: 0xffd08a },
  { id: 'lola_shadow', kind: 'skin', fighter: 'lola', name: 'Ombre', level: 7, tint: 0xb9a8d8 },
];
