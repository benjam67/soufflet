import { describe, expect, it } from 'vitest';
import { computeLayout, computeStrike, STRIKE_OVERLAP } from '../../src/logic/layout';
import { STAGE } from '../../src/config/balance';
import assets from '../../src/config/assets.json';

// Formats d'écran en monde Phaser (hauteur 720, largeur étendue selon le ratio).
const SCREENS: [string, number, number][] = [
  ['iPhone 844×390', Math.round((844 / 390) * 720), 720],
  ['Android 20:9', 1600, 720],
  ['16:9', 1280, 720],
  ['4:3 (tablette)', 1280, 960],
];

describe('placement de la scène', () => {
  for (const [name, w, h] of SCREENS) {
    describe(name, () => {
      const L = computeLayout(w, h);

      it('affiche Bernard et Lola avec le même facteur d’échelle', () => {
        expect(L.left.scale).toBe(L.right.scale);
      });

      it('met Bernard à gauche, Lola à droite en miroir, sans chevauchement', () => {
        expect(L.left.flipX).toBe(false);
        expect(L.right.flipX).toBe(true);
        expect(L.left.right).toBeLessThan(L.right.left);
      });

      it('garde les combattants entièrement à l’écran', () => {
        for (const f of [L.left, L.right]) {
          expect(f.left).toBeGreaterThanOrEqual(0);
          expect(f.right).toBeLessThanOrEqual(w);
          expect(f.top).toBeGreaterThan(h * 0.15); // place pour l'interface en haut
          expect(f.y).toBeLessThanOrEqual(h);
        }
      });

      it('place le patron au centre, entre les combattants, au fond', () => {
        expect(L.patron.x).toBeGreaterThan(L.left.right);
        expect(L.patron.x).toBeLessThan(L.right.left);
        expect(L.patron.y).toBeLessThan(L.left.y);
      });

      it('aligne les 8 habitués au fond, à ~45 % de la taille des combattants', () => {
        expect(L.crowd).toHaveLength(8);
        const fighterFig = assets.fighters.bernard.idle.height * L.fighterScale;
        const heights = L.crowd.map((c) => c.y - c.top).sort((a, b) => a - b);
        const median = (heights[3] + heights[4]) / 2;
        expect(median / fighterFig).toBeCloseTo(STAGE.crowdRatio, 2);
        for (const c of L.crowd) {
          expect(c.y).toBeLessThan(L.left.y);
          expect(c.x).toBeGreaterThan(0);
          expect(c.x).toBeLessThan(w);
        }
      });

      it('couvre tout l’écran avec le décor', () => {
        expect(L.decor.x).toBeLessThanOrEqual(0);
        expect(L.decor.y).toBeLessThanOrEqual(0);
        expect(L.decor.x + assets.props.decor.width * L.decor.scale).toBeGreaterThanOrEqual(w - 0.01);
        expect(L.decor.y + assets.props.decor.height * L.decor.scale).toBeGreaterThanOrEqual(h - 0.01);
      });

      it('le pas en avant amène la main sur le visage adverse, dans les deux sens', () => {
        for (const [side, a, d] of [
          ['left', 'bernard', 'lola'],
          ['right', 'lola', 'bernard'],
        ] as const) {
          const k = computeStrike(L, side, a, d);
          const att = L[side];
          const s = L.fighterScale;
          const hand = att.x + k.dir * (k.step + assets.fighters[a].reach.x * s);
          const def = L[side === 'left' ? 'right' : 'left'];
          const face = def.x - k.dir * assets.fighters[d].face.x * s;
          expect(k.step).toBeGreaterThan(0);
          expect(k.dir * (hand - face)).toBeCloseTo(STRIKE_OVERLAP * s, 5);
          // Impact à hauteur de visage, dans le haut de la silhouette adverse.
          expect(k.impactY).toBeLessThan(def.y - (def.y - def.top) * 0.6);
          expect(k.impactY).toBeGreaterThan(def.top);
        }
      });
    });
  }
});
