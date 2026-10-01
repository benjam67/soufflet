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

### Retours du jalon 2 — 2026-10-01
- Écran de victoire : le texte « ENTRAÎNEMENT » débordait du bouton avec la vraie police (Dela Gothic One, plus large que la police de secours). Les libellés des boutons sont maintenant réduits automatiquement pour tenir dans le bouton (290 × 66).
- Nouveau décor fourni (bar de village 4:3, 1024 × 768, ring en scotch octogonal) intégré à la place du décor provisoire. Ligne du sol calée sur le pied du comptoir (`STAGE.decorFloorY = 420`).

## Phase 3 · Le spectacle — 2026-10-01 (jalon : test par le propriétaire)

**Fait**
- **Impact** (`src/fx/Fx.ts`) : éclair blanc et orange en étoile (3 variantes) avec étincelles, lignes de focus manga convergeant vers l'impact, onomatopée « バシッ！ » + « CLAAAC ! » (critique : « バシーン！ » + « CLAAAAAAC ! », gifle molle : « ペチ… » + « PLOC… », surchauffe : « ピシャ！ » + « PAF ! »), chiffre de dégâts, étiquettes CRITIQUE ×2 / EFFLEURÉE / RATÉE… / GIFLE MOLLE… / SURCHAUFFE !
- **Temps** : arrêt sur image de 80 ms au contact (tout se fige, y compris les animations), puis ralenti ×0,35 pendant ~0,4 s sur les gros coups (≥ 20 dégâts ou critique) et ×0,4 au K.O. ; tremblement de caméra dosé selon la puissance ; flash blanc plein écran sur les critiques et le K.O.
- **Réactions** : traces de main rouges qui s'accumulent sur la joue pendant le round (jusqu'à 6, effacées au round suivant), gouttes qui volent sur les gros coups, dents à partir de 25 dégâts, recul de la victime proportionnel à la puissance.
- **Foule** (`src/fx/Crowd.ts`) : chaque habitué respire à son rythme, saute et se dandine avec son propre retard quand ça claque (2 sauts sur les gros coups), s'affaisse en secouant la tête sur une gifle molle ou ratée. Le patron siffle chaque début de round et le K.O. (petit saut + bulle « PRRRT ! »).
- **Commentateur** : bandeau en bas d'écran, 30 phrases en 9 situations (début de match, critique, gros coup, normal, effleurée, ratée, gifle molle, surchauffe, K.O.), jamais deux fois de suite la même (`src/config/comments.ts`).
- **Sons** (`src/audio/sfx.ts`), tous générés en code avec Web Audio (0 octet à télécharger) : claque (dosée selon la puissance, grave en plus sur les critiques), souffle du bras, cri de la victime (grave pour Bernard, aigu pour Lola), sifflet à trille, clameur et huées de la foule, cloche de K.O., bips des 2 dernières secondes du chrono, musique en boucle façon générique d'anime (132 BPM, La mineur). Le son démarre au premier contact (règle des navigateurs). Bouton son en haut à droite, choix mémorisé (`localStorage`).

**Performance**
- Tous les textes à gros contour (annonces, bandeaux, onomatopées, phrases du commentateur, chiffres de 0 à 9) et les effets sont tracés une seule fois au chargement (`src/fx/bake.ts`) : aucun texte n'est retracé ni renvoyé au GPU pendant le combat. Le pourcentage de la jauge utilise ces chiffres pré-rendus.
- La jauge, le chrono et la traîne des barres de vie ne se redessinent que quand un pixel change.
- Mesure (processeur ralenti ×4, mobile émulé) : travail du jeu (logique, animations, effets) médiane < 1 ms, p95 6–7 ms, p99 ~10 ms par image, soit moins de la moitié du budget de 16,7 ms d'une image à 60 fps.
- Limite de la mesure : le bac à sable n'a pas de GPU, WebGL y est rastérisé en logiciel (≈ 8 images/s quoi qu'on affiche). Le temps de rendu mesuré ici n'est donc pas représentatif d'un téléphone ; le 60 fps réel est à confirmer sur ton téléphone.
- Chargement : 30 fichiers, 1,92 Mo décodés, 1,06 Mo transférés (< 3 Mo).
- Mesure sur un vrai GPU (navigateur du propriétaire, Apple M1, viewport 844 × 390, démo IA avec tous les effets) : **60 images/s stables, 2 000 images d'affilée, aucune au-dessus de 20 ms**.
- Chiffres pré-rendus espacés selon leur encre réelle (mesurée au chargement) : rendu identique quelle que soit la police disponible.
- Placement : chiffre de dégâts juste au-dessus de l'impact, onomatopée projetée derrière la victime (jamais sur le visage de celui qui gifle), dans les deux sens.

**Tests**
- 8 nouveaux tests Playwright (19 au total), avec captures prises en figeant la boucle du jeu à l'instant exact de l'effet : impact (éclair, focus, onomatopée, son, foule, commentateur), critique (flash, ralenti, gouttes et dents), traces de main qui s'accumulent, sifflet du patron et foule qui bouge, K.O., bouton son mémorisé, poids du chargement, performance.

### Retours du jalon 3 — 2026-10-01
- **Musique refaite** (`src/audio/music.ts`), sur la demande « fais une ambiance anime » : générique de combat façon anime 90s, 156 BPM, do majeur / la mineur.
  - Structure : intro (nappe + arpège, puis la batterie arrive), couplet de 8 mesures (La m – Fa – Sol – Do, montée sur Mi majeur), refrain de 8 mesures sur l'enchaînement « royal road » des génériques japonais (Fa – Sol – Mi m – La m, avec Mi majeur avant la résolution). Couplet + refrain en boucle.
  - Instruments : mélodie (deux dents de scie désaccordées + carré à l'octave, petit glissé d'attaque, vibrato qui arrive sur les notes tenues, écho en croche pointée), guitare saturée en accords de puissance (croches au refrain), basse qui pompe en octaves, nappe et arpège au couplet, batterie complète (grosse caisse, caisse claire, charleston, cymbale, roulements), réverbération.
  - Mixage mesuré instrument par instrument : la mélodie mène (≈ −21 dB), grosse caisse / basse / guitare juste en dessous. L'ancienne version avait une mélodie 17 dB sous la basse, d'où l'impression d'un bourdonnement sans air.
  - `npm run music -- fichier.wav` rend le morceau en fichier pour l'écouter hors du jeu.

## Phase 4 · Mode solo — 2026-10-01

**Fait**
- IA à 3 niveaux (`src/logic/ai.ts`), qui joue avec exactement les mêmes règles que le joueur (même jauge, même zone dorée, même chrono, mêmes dégâts) : seule la précision « humaine » simulée change — erreur de relâchement (écart type en ms), vitesse et angle du swipe.
  - Facile : σ 130 ms, swipe 1,4 px/ms, angle σ 15°.
  - Normal : le « joueur moyen » (σ 110 ms, 1,5 px/ms, 14°).
  - Difficile : σ 105 ms, 1,6 px/ms, 13°.
- Mode solo : le joueur à gauche (Bernard), l'IA à droite (Lola) ; l'IA arme et gifle seule, les touchers pendant son tour sont ignorés. Étiquette « SOLO · FACILE / NORMAL / DIFFICILE ».
- Fin de match en solo : « VICTOIRE ! » ou « DÉFAITE… » (bandeau sombre) du point de vue du joueur ; REVANCHE au même niveau ; après une victoire, bouton NIVEAU SUIVANT (facile → normal → difficile).
- Accès : `?mode=solo&level=easy|normal|hard` (le choix du mode et du perso arrivera avec l'écran titre, phase 7).

**Calibrage** (critère de la roadmap, vérifié par simulation)
- Un match compte ~29 gifles : un petit écart de précision par gifle devient un gros écart de victoires. Des profils trop différents donnaient 0–3 % ou 90–99 % de victoires ; les valeurs retenues sont très proches du joueur moyen.
- Facile contre joueur moyen : 30–31 % de victoires, donc **~70 % de défaites**. Difficile contre joueur moyen : **60–62 % de victoires** (3 × 1000 matchs, persos, côtés et premier joueur alternés).

**Tests**
- 3 tests unitaires de plus (71) : facile perd 62–78 %, difficile gagne 52–68 % sur 1000 matchs, mêmes règles pour tous les profils.
- 3 tests Playwright de plus (22) : le joueur gifle puis l'IA répond seule avec une vraie gifle, touchers ignorés pendant son tour ; match complet perdu contre l'IA difficile → « DÉFAITE… » sans « NIVEAU SUIVANT » ; les 3 niveaux se lancent depuis l'URL.

## Phase 5 · Mécaniques avancées — 2026-10-01

**Fait**
- **Rage** (`src/logic/match.ts`) : +1 par dégât reçu (gifle, gifle molle, surchauffe), plafonnée à 100, conservée d'un round à l'autre. Pleine, elle débloque la gifle spéciale au tour suivant du perso, puis retombe à 0 au lancement de la spéciale. Une gifle molle ou une surchauffe ne gaspille pas la spéciale.
- **Gifles spéciales** : Le Battoir (Bernard, une gifle énorme) et La Toupie (Lola, 3 gifles enchaînées à ×0,7). Annonce plein écran, flash rose, ralenti et tremblement renforcés ; La Toupie fait reculer la barre de vie coup par coup, avec un chiffre et une trace de main par gifle.
- **Sonné** : après un coup de 25 dégâts ou plus, la victime joue son prochain tour avec une jauge irrégulière — vitesse tirée au hasard entre −30 % et +30 %, nouvelle valeur toutes les ~260 ms avec raccords en douceur (`stunCurve`). Étoiles qui tournent au-dessus de la tête et étiquette « SONNÉ ! » jusqu'à la fin de son tour. L'IA subit la même jauge : elle vise sans connaître la courbe.
- **Interface** : jauge de rage fine sous la barre de vie (rouge, puis rose qui pulse + « RAGE MAX ! ») ; au tour du perso, aura rosée et étiquette « LE BATTOIR PRÊT ! » / « LA TOUPIE PRÊT ! ».
- Sons : montée « transformation » à la rage pleine et au lancement de la spéciale, gazouillis d'oiseaux quand un perso est sonné. 10 phrases de commentateur en plus (rage, Battoir, Toupie, sonné).

**Équilibrage**
- Avec les valeurs de la roadmap (Battoir ×1,8, Toupie 3 × 0,7 = ×2,1), Lola passait à 55–56 % de victoires. **Le Battoir passe à ×2,0** : Bernard 48–51 % / Lola 49–52 % sur 3 × 1000 matchs.
- En moyenne par match : ~3 spéciales, ~5,5 états sonnés, ~90 s, ~26 tours.
- Paliers de la jauge sonnée à 260 ms plutôt que plus courts : en dessous, les ±30 % se lissent et ne se sentent pas.

**Tests**
- 15 tests unitaires de plus (86) : rage (gain, plafond, déblocage, conservation), spéciales (dégâts exacts, rage à 0, pas de gaspillage), sonné (seuil de 25, durée d'un tour, bornes et douceur de la courbe, surchauffe selon la courbe), équilibre 40–60 % sur 200 matchs avec ces mécaniques.
- 4 tests Playwright de plus (26) : rage pleine → RAGE MAX et spéciale prête ; Le Battoir (annonce, dégâts, rage à 0) ; La Toupie (3 chiffres, 3 traces, total des dégâts) ; sonné (étoiles, vitesse de jauge mesurée image par image, état levé après le tour).
