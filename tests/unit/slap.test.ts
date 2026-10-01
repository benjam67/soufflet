import { describe, expect, it } from 'vitest';
import {
  chargeAt,
  computeSlap,
  isGolden,
  isOverheated,
  precisionFactor,
  speedFactor,
  swipeAngle,
} from '../../src/logic/slap';
import { SlapGesture } from '../../src/logic/gesture';
import { FIGHTERS } from '../../src/config/balance';

describe('charge', () => {
  it('monte linéairement de 0 à 100 % sur le temps du perso', () => {
    expect(chargeAt(0, 1400)).toBe(0);
    expect(chargeAt(700, 1400)).toBe(50);
    expect(chargeAt(1400, 1400)).toBe(100);
    expect(chargeAt(5000, 1400)).toBe(100);
  });
  it('Lola charge plus vite que Bernard', () => {
    expect(chargeAt(500, FIGHTERS.lola.chargeTimeMs)).toBe(50);
    expect(chargeAt(500, FIGHTERS.bernard.chargeTimeMs)).toBeCloseTo(35.71, 2);
  });
  it('accepte un facteur de vitesse (état sonné)', () => {
    expect(chargeAt(700, 1400, 1.3)).toBeCloseTo(65, 5);
  });
});

describe('zone dorée', () => {
  it('Bernard : 80–90 % bornes incluses', () => {
    const z = FIGHTERS.bernard.goldenZone;
    expect(isGolden(79.9, z)).toBe(false);
    expect(isGolden(80, z)).toBe(true);
    expect(isGolden(90, z)).toBe(true);
    expect(isGolden(90.1, z)).toBe(false);
  });
  it('Lola : 76–92 %', () => {
    const z = FIGHTERS.lola.goldenZone;
    expect(isGolden(76, z)).toBe(true);
    expect(isGolden(92, z)).toBe(true);
    expect(isGolden(93, z)).toBe(false);
  });
});

describe('surchauffe', () => {
  it('se déclenche après plus de 150 ms à 100 %', () => {
    expect(isOverheated(1400 + 150, 1400)).toBe(false);
    expect(isOverheated(1400 + 151, 1400)).toBe(true);
    expect(isOverheated(1000 + 151, 1000)).toBe(true);
  });
});

describe('facteur de vitesse V', () => {
  it('vaut 0,8 en dessous de 0,3 px/ms et 1,3 au-dessus de 2,5 px/ms', () => {
    expect(speedFactor(0)).toBe(0.8);
    expect(speedFactor(0.3)).toBe(0.8);
    expect(speedFactor(2.5)).toBeCloseTo(1.3, 10);
    expect(speedFactor(10)).toBeCloseTo(1.3, 10);
  });
  it('est linéaire entre les deux', () => {
    expect(speedFactor(1.4)).toBeCloseTo(1.05, 10);
  });
});

describe('facteur de précision P', () => {
  it('suit les seuils 15° et 35°', () => {
    expect(precisionFactor(0)).toBe(1);
    expect(precisionFactor(14.9)).toBe(1);
    expect(precisionFactor(15)).toBe(0.7);
    expect(precisionFactor(35)).toBe(0.2);
    expect(precisionFactor(80)).toBe(0.2);
  });
  it('mesure l’angle avec l’horizontale quel que soit le sens', () => {
    expect(swipeAngle(100, 0)).toBe(0);
    expect(swipeAngle(-100, 0)).toBe(0);
    expect(swipeAngle(100, 100)).toBeCloseTo(45, 10);
    expect(swipeAngle(100, -100)).toBeCloseTo(45, 10);
    expect(swipeAngle(0, 50)).toBe(90);
  });
});

describe('formule de dégâts D = B × C/100 × V × P × K × R_d', () => {
  const B = FIGHTERS.bernard;
  const L = FIGHTERS.lola;

  it('gifle parfaite de Bernard sur Lola', () => {
    const r = computeSlap({ attacker: 'bernard', defender: 'lola', charge: 85, speed: 2.5, angle: 0 });
    // B × 0,85 × 1,3 × 1 × 2 × R_d(Lola)
    expect(r.raw).toBeCloseTo(B.base * 0.85 * 1.3 * 1 * 2 * L.resistance, 10);
    expect(r.damage).toBe(Math.round(r.raw));
    expect(r.critical).toBe(true);
    expect(r.factors).toEqual({ B: B.base, C: 85, V: 1.3, P: 1, K: 2, Rd: L.resistance });
    expect(r.contact).toBe('clean');
  });
  it('gifle moyenne de Lola sur Bernard (encaisse mieux)', () => {
    const r = computeSlap({ attacker: 'lola', defender: 'bernard', charge: 60, speed: 1.4, angle: 20 });
    // B × 0,6 × 1,05 × 0,7 (effleurée) × 1 × 0,85
    expect(r.raw).toBeCloseTo(L.base * 0.6 * 1.05 * 0.7 * 1 * B.resistance, 10);
    expect(r.damage).toBe(Math.round(r.raw));
    expect(r.critical).toBe(false);
    expect(r.contact).toBe('grazed');
  });
  it('gifle ratée (angle > 35°)', () => {
    const r = computeSlap({ attacker: 'bernard', defender: 'lola', charge: 100, speed: 0.1, angle: 50 });
    expect(r.raw).toBeCloseTo(B.base * 1 * 0.8 * 0.2 * 1 * L.resistance, 10);
    expect(r.contact).toBe('missed');
  });
  it('arrondit à l’entier le plus proche', () => {
    // 14 × 0,5 × 0,8 × 1 × 1 × 0,85 = 4,76 → 5 (si Bernard se giflait lui-même via la formule)
    const r = computeSlap({ attacker: 'bernard', defender: 'bernard', charge: 50, speed: 0.3, angle: 0 });
    expect(r.raw).toBeCloseTo(B.base * 0.5 * 0.8 * B.resistance, 10);
    expect(r.damage).toBe(Math.round(r.raw));
  });
  it('charge à 0 : aucun dégât', () => {
    expect(computeSlap({ attacker: 'lola', defender: 'bernard', charge: 0, speed: 2, angle: 0 }).damage).toBe(0);
  });
  it('dégât minimum de 1 dès qu’une gifle part', () => {
    expect(computeSlap({ attacker: 'lola', defender: 'bernard', charge: 3, speed: 0.1, angle: 60 }).damage).toBe(1);
  });
  it('multiplicateur supplémentaire pour les spéciales', () => {
    const r = computeSlap({ attacker: 'bernard', defender: 'lola', charge: 50, speed: 0.3, angle: 0, extra: 1.8 });
    expect(r.raw).toBeCloseTo(B.base * 0.5 * 0.8 * L.resistance * 1.8, 10);
  });
});

describe('geste : appui maintenu puis swipe', () => {
  it('produit une gifle avec la charge figée au début du swipe', () => {
    const g = new SlapGesture('bernard', 1);
    g.down(0, 100, 200);
    g.move(600, 103, 201); // reste dans la zone morte
    g.move(700, 105, 200); // dernier point immobile : charge = 50 %
    expect(g.charge(700)).toBe(50);
    g.move(716, 160, 202); // le swipe démarre (une image après le dernier point immobile)
    expect(g.phase).toBe('swiping');
    expect(g.charge(2000)).toBe(50); // figée
    const out = g.up(800, 305, 200);
    expect(out?.type).toBe('slap');
    if (out?.type !== 'slap') return;
    expect(out.charge).toBe(50);
    expect(out.dx).toBe(200);
    expect(out.durationMs).toBe(100);
    expect(out.speed).toBeCloseTo(2, 10);
    expect(out.angle).toBe(0);
  });

  it('sans événement intermédiaire, la charge est figée au premier mouvement (pas à l’appui)', () => {
    // Écran tactile : aucun touchmove tant que le doigt ne bouge pas.
    const g = new SlapGesture('bernard', 1);
    g.down(0, 100, 200);
    g.move(716, 150, 200); // premier événement, déjà hors zone morte
    expect(g.charge(716)).toBe(50); // figée à 716 − 16 = 700 ms
    const out = g.up(800, 300, 200);
    expect(out?.type).toBe('slap');
    if (out?.type === 'slap') {
      expect(out.charge).toBe(50);
      expect(out.durationMs).toBe(100);
    }
  });

  it('le joueur de droite swipe vers la gauche', () => {
    const g = new SlapGesture('lola', -1);
    g.down(0, 600, 200);
    g.move(800, 600, 200);
    g.move(816, 560, 230);
    const out = g.up(900, 400, 260);
    expect(out?.type).toBe('slap');
    if (out?.type === 'slap') {
      expect(out.charge).toBe(80);
      expect(out.dx).toBe(200);
      expect(out.angle).toBeCloseTo(16.7, 1);
    }
  });

  it('annule un swipe trop court ou dans le mauvais sens', () => {
    const a = new SlapGesture('bernard', 1);
    a.down(0, 100, 100);
    a.move(500, 130, 100);
    expect(a.up(550, 150, 100)).toEqual({ type: 'cancel', reason: 'too-short' });

    const b = new SlapGesture('bernard', 1);
    b.down(0, 300, 100);
    b.move(500, 250, 100);
    expect(b.up(550, 100, 100)).toEqual({ type: 'cancel', reason: 'wrong-direction' });
  });

  it('annule si le doigt est levé sans swipe', () => {
    const g = new SlapGesture('bernard', 1);
    g.down(0, 100, 100);
    expect(g.up(500, 102, 100)).toEqual({ type: 'cancel', reason: 'no-swipe' });
  });

  it('surchauffe : gifle sur soi si la jauge reste à 100 % plus de 150 ms', () => {
    const g = new SlapGesture('lola', 1);
    g.down(0, 100, 100);
    expect(g.update(1150)).toBeNull();
    expect(g.update(1151)).toEqual({ type: 'selfslap', charge: 100 });
    expect(g.phase).toBe('done');
    // Un swipe tardif n'y change rien.
    expect(g.up(1200, 400, 100)).toBeNull();
  });

  it('pas de surchauffe une fois le swipe commencé (charge figée)', () => {
    const g = new SlapGesture('lola', 1);
    g.down(0, 100, 100);
    g.move(950, 100, 100);
    g.move(960, 150, 100);
    expect(g.update(5000)).toBeNull();
    expect(g.up(5000, 400, 100)?.type).toBe('slap');
  });

  it('reset remet le geste à zéro', () => {
    const g = new SlapGesture('bernard', 1);
    g.down(0, 0, 0);
    g.reset();
    expect(g.phase).toBe('idle');
    expect(g.charge(1000)).toBe(0);
  });
});
