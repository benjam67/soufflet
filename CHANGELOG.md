# Changelog

## Phase 0 · Mise en place — 2026-10-01

**Fait**
- Projet Phaser 3.90 + TypeScript (strict) + Vite, Vitest et Playwright (Chromium, mobile émulé 844 × 390 en paysage).
- Dépôt `benjam67/soufflet` (nom choisi par le propriétaire à la place de `slap-fighter`) ; le jeu est servi sous `/soufflet/`.
- Déploiement automatique sur GitHub Pages à chaque push sur `main` (`.github/workflows/deploy.yml` : tests unitaires, build, publication).
- PWA : `manifest.webmanifest` (plein écran, paysage), icônes générées à partir du visage de Bernard, plein écran + verrouillage paysage au premier toucher quand le navigateur le permet. Pas de service worker pour l'instant (évite les versions en cache pendant le développement).
- Écran « Tourne ton téléphone » en portrait (CSS pur, s'affiche avant même le chargement du jeu).
- Scène de combat statique : décor, 8 habitués, patron, Bernard à gauche, Lola à droite en miroir.

**Assets**
- `scripts/optimize-assets.mjs` (`npm run assets`) : sources PNG dans `raw/`, sorties WebP dans `public/assets/`, données de placement dans `src/config/assets.json`.
- Combattants : toutes les poses d'un perso recadrées sur la même boîte (union des poses) pour garder ancrage et ligne de pieds communs, puis réduites avec le **même facteur** pour Bernard et Lola (600/823, Bernard ≈ 600 px de haut).
- Total des assets : ~694 Ko. Build complet (Phaser compris) : ~2,2 Mo non compressé, ~1 Mo transféré.
- `decor.png` n'était pas fourni : décor provisoire dessiné en SVG (`raw/bar/decor-placeholder.svg`, 16:9). Il suffira de déposer `raw/bar/decor.png` et de relancer `npm run assets` ; ajuster alors `STAGE.decorFloorY` (ligne du sol en px dans l'image).

**Réglages choisis** (`src/config/balance.ts`, section `STAGE`)
- Monde Phaser de 720 px de haut, largeur étendue selon l'écran (`Scale.EXPAND`) : pas de bandes noires sur les téléphones 19,5:9 / 20:9.
- Silhouette des combattants à 66 % de la hauteur d'écran, pieds à 4,5 % du bas ; écart de 14 % de la largeur entre l'avant des deux persos.
- Habitués à 45 % de la taille des combattants, teinte assombrie `0xb3a49c` ; patron un peu plus grand, teinte `0xd4c6bd`.

**Note technique**
- Phaser retourne la texture dans son cadre sans déplacer l'origine : pour le perso en miroir, l'origine horizontale est `1 - originX`.
