import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { FightScene } from './scenes/FightScene';

declare global {
  interface Window {
    __slap?: {
      ready: boolean;
      scene?: string;
      layout?: unknown;
      state?: Record<string, unknown>;
      game?: Phaser.Game;
    };
  }
}

window.__slap = { ready: false };

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1A1020',
  // Hauteur de référence 720 ; la largeur s'étend selon le format de l'écran.
  scale: {
    mode: Phaser.Scale.EXPAND,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  input: { activePointers: 2 },
  render: { antialias: true, powerPreference: 'high-performance' },
  fps: { target: 60 },
  scene: [BootScene, FightScene],
});

window.__slap.game = game;

// Plein écran + verrouillage paysage au premier contact (navigateurs qui le permettent).
const goFullscreen = () => {
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => {});
  }
};
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch && !matchMedia('(display-mode: fullscreen)').matches) {
  window.addEventListener('pointerup', goFullscreen, { once: true });
}
