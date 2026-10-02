// Marges de sécurité de l'écran (encoche, coins arrondis, barre d'accueil de l'iPhone),
// converties dans les unités du jeu. L'image de fond va jusqu'au bord ; l'interface, non.
import type Phaser from 'phaser';

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

let probe: HTMLDivElement | null = null;

/** Marges en px CSS. `?safe=gauche,droite,haut,bas` les force (tests, essais sur ordinateur). */
export function cssInsets(): Insets {
  const forced = new URLSearchParams(location.search).get('safe');
  if (forced) {
    const [left = 0, right = 0, top = 0, bottom = 0] = forced.split(',').map((v) => Number(v) || 0);
    return { left, right, top, bottom };
  }
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
  }
  const s = getComputedStyle(probe);
  const px = (v: string) => parseFloat(v) || 0;
  return { left: px(s.paddingLeft), right: px(s.paddingRight), top: px(s.paddingTop), bottom: px(s.paddingBottom) };
}

/** Marges dans les unités de la scène. */
export function safeInsets(scene: Phaser.Scene): Insets {
  const c = cssInsets();
  const ds = scene.scale.displayScale;
  return { left: c.left * ds.x, right: c.right * ds.x, top: c.top * ds.y, bottom: c.bottom * ds.y };
}

/** iPhone ou iPad dans Safari (pas installé sur l'écran d'accueil) : pas de vrai plein écran possible. */
export function needsInstallHint(): boolean {
  if (new URLSearchParams(location.search).get('ios') === '1') return true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  return ios && !standalone;
}
