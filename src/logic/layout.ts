// Calcul pur du placement de la scène de combat (sans Phaser), testable seul.
import { STAGE } from '../config/balance';
import assets from '../config/assets.json';

export const HABITUES = [
  'vieux_beret',
  'fermier',
  'grandmere',
  'facteur',
  'jeune_siffleur',
  'mecano',
  'boulanger',
  'femme_cardigan',
] as const;
export type HabitueId = (typeof HABITUES)[number];

export interface Placed {
  x: number;
  y: number;
  scale: number;
}

export interface FighterPlacement extends Placed {
  flipX: boolean;
  /** Bords de la silhouette idle à l'écran. */
  left: number;
  right: number;
  top: number;
}

export interface StageLayout {
  width: number;
  height: number;
  decor: { x: number; y: number; scale: number };
  fighterScale: number;
  left: FighterPlacement;
  right: FighterPlacement;
  patron: Placed & { top: number };
  crowd: (Placed & { id: HabitueId; top: number })[];
  crowdScale: number;
}

type FighterAsset = (typeof assets.fighters)['bernard'];

export function computeLayout(
  width: number,
  height: number,
  leftId: 'bernard' | 'lola' = 'bernard',
  rightId: 'bernard' | 'lola' = 'lola',
): StageLayout {
  const L = assets.fighters[leftId] as FighterAsset;
  const R = assets.fighters[rightId] as FighterAsset;

  // Décor : couvre tout l'écran, sol placé vers 56 % de la hauteur.
  const dw = assets.props.decor.width;
  const dh = assets.props.decor.height;
  const ds = Math.max(width / dw, height / dh);
  const floorScale = STAGE.decorFloorY * (dh / 900);
  const decorX = (width - dw * ds) / 2;
  let decorY = height * STAGE.decorFloorScreen - floorScale * ds;
  decorY = Math.min(0, Math.max(height - dh * ds, decorY));
  const decorFloor = decorY + floorScale * ds;

  // Combattants : même facteur d'échelle pour les deux (rapport de taille conservé),
  // calé sur le plus grand des deux pour que personne ne sorte de l'écran.
  const tallest = Math.max(L.idle.height, R.idle.height);
  const fighterScale = (height * STAGE.fighterHeight) / tallest;
  const feetY = height * (1 - STAGE.fighterFeetFromBottom);

  // Les sprites regardent vers la droite ; celui de droite est en miroir.
  // On centre le duo, avec un écart fixe entre l'avant des deux silhouettes.
  const gap = width * STAGE.fighterGap;
  const lFront = L.idle.right * fighterScale; // avant de gauche (côté droit)
  const lBack = -L.idle.left * fighterScale;
  const rFront = R.idle.right * fighterScale; // en miroir : avant côté gauche
  const rBack = -R.idle.left * fighterScale;
  const total = lBack + lFront + gap + rFront + rBack;
  const startX = (width - total) / 2;
  const leftX = startX + lBack;
  const rightX = leftX + lFront + gap + rFront;

  const left: FighterPlacement = {
    x: leftX,
    y: feetY,
    scale: fighterScale,
    flipX: false,
    left: leftX - lBack,
    right: leftX + lFront,
    top: feetY - L.idle.height * fighterScale,
  };
  const right: FighterPlacement = {
    x: rightX,
    y: feetY,
    scale: fighterScale,
    flipX: true,
    left: rightX - rFront,
    right: rightX + rBack,
    top: feetY - R.idle.height * fighterScale,
  };

  // Habitués : ~45 % de la taille des combattants, alignés devant le comptoir.
  const fighterFigure = tallest * fighterScale;
  const crowdHeights = HABITUES.map((h) => assets.props[`habitue_${h}`].height).sort((a, b) => a - b);
  const medianCrowd = (crowdHeights[3] + crowdHeights[4]) / 2;
  const crowdScale = (fighterFigure * STAGE.crowdRatio) / medianCrowd;
  const crowdFeet = decorFloor + 14 * ds;

  // Le patron : au fond, au centre, un peu plus grand (bras levé, gabarit costaud).
  const patronScale = (fighterFigure * STAGE.crowdRatio * 1.2) / (assets.props.patron.height * 0.86);
  const patron = {
    x: (left.right + right.left) / 2,
    y: crowdFeet + 6 * ds,
    scale: patronScale,
    top: crowdFeet + 6 * ds - assets.props.patron.height * patronScale,
  };

  // 4 habitués de chaque côté du patron, répartis sur la largeur du comptoir.
  const span = Math.min(width, dw * ds) * 0.84;
  const x0 = width / 2 - span / 2;
  const centerGap = span * 0.16;
  const sideSpan = (span - centerGap) / 2;
  const crowd = HABITUES.map((id, i) => {
    const side = i < 4 ? 0 : 1;
    const k = i % 4;
    const x = x0 + side * (sideSpan + centerGap) + (sideSpan * (k + 0.5)) / 4;
    const h = assets.props[`habitue_${id}`].height * crowdScale;
    return { id, x, y: crowdFeet, scale: crowdScale, top: crowdFeet - h };
  });

  return {
    width,
    height,
    decor: { x: decorX, y: decorY, scale: ds },
    fighterScale,
    left,
    right,
    patron,
    crowd,
    crowdScale,
  };
}

/** Enfoncement de la main dans le visage au moment de l'impact (px texture). */
export const STRIKE_OVERLAP = 22;

/**
 * Pas en avant pour que la main (pose slap) atteigne le visage de l'adversaire,
 * et point d'impact à l'écran. `step` est une distance positive vers l'adversaire.
 */
export function computeStrike(
  L: StageLayout,
  attackerSide: 'left' | 'right',
  attackerId: 'bernard' | 'lola',
  defenderId: 'bernard' | 'lola',
) {
  const s = L.fighterScale;
  const att = L[attackerSide];
  const def = L[attackerSide === 'left' ? 'right' : 'left'];
  const dir = attackerSide === 'left' ? 1 : -1;
  const A = assets.fighters[attackerId];
  const D = assets.fighters[defenderId];
  const faceX = def.x - dir * D.face.x * s; // avant du visage (tourné vers l'attaquant)
  const handX = att.x + dir * A.reach.x * s;
  const step = Math.max(0, dir * (faceX - handX) + STRIKE_OVERLAP * s);
  return {
    step,
    dir,
    impactX: faceX - dir * (STRIKE_OVERLAP * s * 0.5),
    impactY: def.y - D.face.y * s,
  };
}
