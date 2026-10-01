// Toutes les valeurs de réglage du jeu. Modifier ici, jamais dans la logique.

export type FighterId = 'bernard' | 'lola';

export interface FighterBalance {
  name: string;
  /** Prénom affiché dans les annonces (« À TOI, BERNARD ! »). */
  short: string;
  katakana: string;
  /** Base B de la formule de dégâts. */
  base: number;
  /** Temps (ms) pour que la jauge monte de 0 à 100 %. */
  chargeTimeMs: number;
  /** Zone dorée [min, max] en % de charge. */
  goldenZone: [number, number];
  /** Résistance R_d appliquée aux dégâts reçus. */
  resistance: number;
  special: { name: string; hits: number; multiplier: number };
}

export const FIGHTERS: Record<FighterId, FighterBalance> = {
  bernard: {
    name: 'Big Bernard',
    short: 'Bernard',
    katakana: 'ベルナール',
    base: 14,
    chargeTimeMs: 1400,
    goldenZone: [80, 90],
    resistance: 0.85,
    special: { name: 'Le Battoir', hits: 1, multiplier: 1.8 },
  },
  lola: {
    name: 'Lola Tornade',
    short: 'Lola',
    katakana: 'ローラ',
    // Valeurs de départ de la roadmap : base 11, résistance 1,1 → Bernard gagnait
    // ~100 % des matchs simulés. Rééquilibré en phase 2 (voir CHANGELOG).
    base: 16,
    chargeTimeMs: 1000,
    goldenZone: [76, 92],
    resistance: 1.0,
    special: { name: 'La Toupie', hits: 3, multiplier: 0.7 },
  },
};

export const MATCH = {
  roundsToWin: 2,
  maxRounds: 3,
  hp: 100,
  turnTimeMs: 3000,
  limpSlapDamage: 5,
};

export const SLAP = {
  /** Temps passé à 100 % avant de se gifler soi-même. */
  overheatGraceMs: 150,
  selfSlapDamage: 8,
  criticalMultiplier: 2,
  minSwipePx: 60,
  speed: { minPxPerMs: 0.3, maxPxPerMs: 2.5, minFactor: 0.8, maxFactor: 1.3 },
  /** Précision selon l'angle du swipe avec l'horizontale. */
  precision: [
    { maxAngleDeg: 15, factor: 1.0 },
    { maxAngleDeg: 35, factor: 0.7 },
    { maxAngleDeg: 90, factor: 0.2 },
  ],
};

export const ADVANCED = {
  rageMax: 100,
  ragePerDamage: 1,
  stunThreshold: 25,
  stunSpeedVariance: 0.3,
};

/** Mise en scène (proportions relatives à la hauteur de l'écran). */
export const STAGE = {
  /** Hauteur de la silhouette idle des combattants, en fraction de la hauteur d'écran. */
  fighterHeight: 0.66,
  /** Ligne des pieds des combattants, distance au bas de l'écran (fraction de hauteur). */
  fighterFeetFromBottom: 0.045,
  /** Écart entre l'avant des deux combattants, en fraction de la largeur d'écran. */
  fighterGap: 0.14,
  /** Taille des habitués par rapport aux combattants. */
  crowdRatio: 0.45,
  /** Teinte d'assombrissement des habitués et du patron. */
  crowdTint: 0xb3a49c,
  patronTint: 0xd4c6bd,
  /** Ligne du sol du décor (px dans decor.webp) et position voulue à l'écran. */
  decorFloorY: 560,
  decorFloorScreen: 0.56,
};
