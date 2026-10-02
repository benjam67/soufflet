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
  special: {
    name: string;
    /** Nombre maximal de gifles (La Toupie : 3, à enchaîner en rythme). */
    hits: number;
    multiplier: number;
    /** Zone dorée propre à la spéciale (plus étroite), si elle diffère. */
    goldenZone?: [number, number];
    /** La jauge monte plus lentement pendant la spéciale (1 = normal). */
    chargeSpeed?: number;
  };
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
    // Le Battoir : une seule gifle énorme, charge lente et zone dorée étroite (à doser soi-même).
    special: { name: 'Le Battoir', hits: 1, multiplier: 2.0, goldenZone: [84, 90], chargeSpeed: 0.8 },
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
    // La Toupie : jusqu'à 3 gifles à enchaîner en rythme. ×0,8 chacune (×0,7 avant que le rythme
    // soit à tenir soi-même : on n'en place plus toujours trois).
    special: { name: 'La Toupie', hits: 3, multiplier: 0.8 },
  },
};

export const MATCH = {
  roundsToWin: 2,
  maxRounds: 3,
  hp: 100,
  turnTimeMs: 3000,
  limpSlapDamage: 5,
  /**
   * Droit de réponse : si celui qui a ouvert la manche met l'autre K.O., ce dernier rend une
   * dernière gifle. Les deux jouent ainsi le même nombre de tours. Double K.O. : gagne celui
   * qui est le moins « en dessous de zéro » ; égalité parfaite : avantage à celui qui répondait.
   */
  rightOfReply: true,
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

/** Esquive, feinte et garde de rage. */
export const DEFENSE = {
  /** Longueur minimale du swipe vers l'arrière (px écran). */
  minSwipePx: 40,
  /** Temps entre le départ de la gifle (doigt levé) et l'impact : le temps de la voir venir. */
  travelMs: 360,
  /** Écart maximal entre l'esquive et l'impact pour une esquive parfaite / correcte (ms). */
  perfectWindowMs: 70,
  goodWindowMs: 170,
  /** Part des dégâts évitée. */
  reduction: { good: 0.3, perfect: 0.6 },
  /** Rage gagnée par une esquive parfaite. */
  perfectRageBonus: 10,
  /** Feinte : durée maximale pendant laquelle l'attaquant peut retenir sa gifle, doigt posé. */
  feintMaxMs: 800,
};

/** La Toupie : délai accepté entre deux gifles de l'enchaînement (ms). */
export const COMBO = { minGapMs: 180, maxGapMs: 700 };

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
  /** Ligne du sol au pied du comptoir (px dans decor.webp) et position voulue à l'écran. */
  decorFloorY: 420,
  decorFloorScreen: 0.56,
};
