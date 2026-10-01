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

**Déploiement et vérification**
- GitHub Pages activé automatiquement via la branche `gh-pages` (l'API de réglage de Pages n'est pas accessible depuis la session) : la CI build, teste et pousse `dist/` sur `gh-pages` à chaque push sur `main`. Le commit déployé est lisible dans `version.txt`.
- Tests Playwright (3/3) passés en local sur le build de production, mobile émulé 844 × 390.
- `github.io` n'est pas joignable depuis le bac à sable de Claude : la version en ligne est vérifiée dans le navigateur du propriétaire (viewport 844 × 390) — scène chargée, aucune erreur console, ~1,1 Mo transférés.

## Phase 1 · La gifle — 2026-10-01

**Fait**
- Logique pure dans `src/logic/` :
  - `slap.ts` : charge, zone dorée, surchauffe, facteurs V (vitesse) et P (angle), formule `D = B × C/100 × V × P × K × R_d` arrondie à l'entier (minimum 1 dès qu'une gifle part).
  - `gesture.ts` : machine à états du geste (appui → armement → swipe → gifle / surchauffe / annulation).
  - `layout.ts` : `computeStrike` calcule le pas en avant pour que la main (pose slap) atteigne l'avant du visage adverse.
- Contrôles tactiles : maintenir n'importe où pour armer, glisser vers l'adversaire sans lever le doigt. Positions mesurées en px CSS (les seuils de la roadmap sont en px écran).
- Interface : barres de vie inclinées à contour noir (nom + katakana, traîne rouge des dégâts récents), jauge de charge verticale à gauche (zone dorée encadrée de blanc, surchauffe rouge en haut, CHARGE… / PARFAIT ! / SURCHAUFFE !), chiffres de dégâts, étiquette « CRITIQUE ×2 ».
- Enchaînement : windup pendant la charge → swing 60 ms → slap avec pas en avant (70 ms) → contact et arrêt sur image 80 ms → hit + léger recul de la victime → retour en place → idle.
- Mode entraînement : Bernard gifle Lola en boucle ; K.O. → dazed/victory puis remise à 100 PV.

**Réglages et choix**
- Zone morte de 10 px avant de considérer que le swipe commence ; un swipe < 60 px ou dans le mauvais sens est annulé (le perso revient en idle, sans dégâts).
- Les écrans tactiles n'envoient pas d'événement tant que le doigt ne bouge pas : le début du swipe (et donc la charge figée) est pris au plus 16 ms avant le premier mouvement détecté.
- Enfoncement de la main dans le visage au contact : 22 px de texture (`STRIKE_OVERLAP`).
- Le contact se fait sur la pose idle de la victime, puis la pose hit (très penchée en arrière) arrive après l'arrêt sur image : la main touche bien la joue.

**Tests**
- 52 tests unitaires (formule, zone dorée, surchauffe, V, P, geste, placement, pas en avant).
- 8 tests Playwright (mobile 844 × 390, vrais événements tactiles via le protocole DevTools) : appui + swipe fait baisser les PV de Lola avec l'enchaînement de poses exact, critique dans la zone dorée, surchauffe (−8 PV sur Bernard), swipe trop court / à l'envers sans effet, aucune erreur console.
- Le test du critique s'auto-corrige d'un essai à l'autre (le navigateur de test livre les événements avec 100–200 ms de retard, la fenêtre dorée de Bernard ne dure que 140 ms).

## Phase 2 · Le match — 2026-10-01 (jalon : test par le propriétaire)

**Fait**
- `src/logic/match.ts` : match pur (sans Phaser) — tours alternés, gifle, surchauffe, gifle molle au chrono (5 dégâts), K.O., rounds (2 gagnants, 3 au maximum), victoire. Le perdant d'un round commence le suivant.
- `src/logic/ai.ts` + `rng.ts` : IA « joueur moyen » reproductible (graine). Elle vise le centre de la zone dorée avec une erreur de timing en millisecondes (σ = 110 ms), comme un réflexe humain.
- `src/logic/simulate.ts` : simulation de matchs complets sans affichage ; `npm run sim` affiche un rapport d'équilibrage.
- Écran : mode 2 joueurs sur le même téléphone (mode par défaut), annonces ROUND 1 / ROUND FINAL / BAGARRE !, bandeau rouge incliné « À TOI, BERNARD ! », chrono du tour dans un losange central (rouge à la dernière seconde), losanges des rounds gagnés, K.O. !, « ROUND POUR … ! », écran de victoire (vainqueur en pleine lumière, score, boutons REVANCHE et ENTRAÎNEMENT).
- Gifle molle : le perso avance mollement, petit éclair, étiquette « GIFLE MOLLE… ».
- Paramètres d'URL : `?mode=training` (entraînement), `?autoplay=1` (démo IA contre IA), `?speed=N` (tout accélérer), `?seed=N` (IA reproductible).
- Aide « MAINTIENS pour armer · GLISSE vers … » affichée pendant les deux premiers tours du match.

**Équilibrage** (décidé seul, comme prévu par la roadmap)
- Avec les valeurs de départ, Bernard gagnait ~100 % des matchs simulés : il frappe plus fort (14 contre 11) et encaisse mieux (×0,85 contre ×1,1), et la jauge rapide de Lola ne compense rien.
- Réglage retenu, le plus petit qui garde l'identité des persos : **Lola base 11 → 16, résistance 1,1 → 1,0**. Bernard reste le plus résistant (×0,85) ; Lola devient la plus offensive, avec sa zone dorée plus large.
- Résultat (3 × 1000 matchs) : Bernard 51–53 % / Lola 47–49 %, ~100 s par match, ~29 tours, 2,6 rounds en moyenne, ~50 % de critiques, surchauffes ~0,1 %.

**Tests**
- 68 tests unitaires, dont le déroulé du match (tours, chrono, surchauffe, K.O., rounds, 2–0 et 1–1–décisif) et 200 matchs simulés : tous se terminent, équilibre dans 40–60 %, durée moyenne entre 45 s et 3 min.
- 11 tests Playwright, dont : Bernard gifle → bandeau « À TOI, LOLA ! » → Lola gifle vers la gauche ; chrono dépassé → gifle molle de 5 ; démo IA jusqu'à l'écran de victoire puis REVANCHE qui relance un match.
