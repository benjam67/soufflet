# Slap Fighter – Roadmap de développement

Oct 1, 2026 · @Benjam

## Contexte et objectif

Objectif : un prototype jouable sur mobile d'un jeu de gifles façon jeu de combat anime, à partager entre amis par un simple lien.

- **Pitch** : deux combattants face à face dans un bar de village français, à la fermeture. Ils ne se déplacent pas et s'envoient des gifles à tour de rôle. Ton absurde et exagéré.
- **Plateforme** : jeu web (PWA) en mode paysage, jouable sur iOS et Android depuis un navigateur.
- **Équipe** : un seul développeur, en vibecoding. Claude code, teste et déploie en autonomie ; le propriétaire du projet ne teste qu'aux jalons indiqués.
- **Priorité** : le plaisir de la gifle avant tout. Chaque phase doit rester jouable et déployée.
- **Hors périmètre** : publication sur les stores, monétisation, comptes utilisateurs.

## Règles du jeu

Un match se joue en 2 rounds gagnants (3 au maximum), chaque round avec 100 PV par joueur ; les joueurs giflent à tour de rôle et celui qui reçoit subit sans agir.

### Déroulé d'un tour

1. **Armer** : le joueur pose le doigt et le maintient. La jauge de charge monte de 0 à 100 %.
2. **Zone dorée** : relâcher le geste quand la jauge est dans la zone dorée donne un coup critique (×2).
3. **Surchauffe** : si la jauge reste à 100 % plus de 150 ms, le perso se gifle lui-même (8 dégâts sur lui) et le tour passe.
4. **Frapper** : sans lever le doigt, le joueur swipe horizontalement vers l'adversaire (au moins 60 px). La charge est figée au début du swipe.
5. **Chrono** : 3 secondes maximum par tour. Au-delà, gifle molle automatique de 5 dégâts.

### Calcul des dégâts

```latex
D = B \times \frac{C}{100} \times V \times P \times K \times R_{d}
```

- B = base du perso, C = charge en %.
- V = vitesse du swipe : de 0,8 (lent) à 1,3 (très rapide), linéaire entre 0,3 et 2,5 px/ms.
- P = précision selon l'angle du swipe avec l'horizontale : moins de 15° = 1,0 ; 15 à 35° = 0,7 (la gifle effleure) ; plus de 35° = 0,2 (gifle ratée).
- K = 2 si la charge était dans la zone dorée, sinon 1.
- R\_d = résistance du perso qui reçoit.

### Personnages (valeurs de départ)

| Perso | Base B | Montée de jauge 0 → 100 % | Zone dorée | Résistance R\_d | Gifle spéciale |
| --- | --- | --- | --- | --- | --- |
| Big Bernard | 14 | 1,4 s | 80–90 % | 0,85 (encaisse mieux) | Le Battoir : une gifle ×1,8 |
| Lola Tornade | 11 | 1,0 s | 76–92 % | 1,1 | La Toupie : 3 gifles à ×0,7 |

### Mécaniques avancées (phase 5)

- **Rage** : +1 point par dégât reçu, 100 maximum. Pleine, elle débloque la gifle spéciale au tour suivant, puis retombe à 0.
- **Sonné** : après un coup de 25 dégâts ou plus, au tour suivant la jauge de la victime monte de façon irrégulière (vitesse ±30 %, aléatoire).
- **KO** : un perso à 0 PV perd le round. Pose « dazed » pour le perdant, « victory » pour le gagnant.

Toutes ces valeurs vivent dans un seul fichier de configuration (`src/config/balance.ts`) pour être réglées sans toucher à la logique.

## Direction artistique

Style anime de baston des années 90, comique et exagéré ; la référence visuelle de l'interface et des effets est la [maquette Slap Fighter](https://claude.ai/artifact/993HtiDhMQQGK2257KPoG2) (écran d'armement et écran d'impact).

- **Interface** : barres de vie inclinées avec contour noir épais, noms des persos aussi en katakana (ベルナール, ローラ), losanges pour les rounds gagnés, chrono du tour dans un losange central, jauge de rage fine sous la barre de vie.
- **Polices** (Google Fonts) : Dela Gothic One pour les titres, annonces et onomatopées ; M PLUS 1p (500 et 800) pour l'interface.
- **Couleurs de l'interface** : encre #1A1020, jaune #FFC93C, rouge #E8304A, rose #FF3D8B, cyan #35C8F0, crème #FFF7E8.
- **Jauge de charge** : verticale à gauche, zone dorée encadrée de blanc, zone de surchauffe rouge en haut, libellé « CHARGE… / PARFAIT ! / SURCHAUFFE ! ».
- **Annonce de tour** : bandeau rouge incliné « À TOI, BERNARD ! » façon annonce d'anime.
- **Impact** : arrêt sur image (80 ms), ralenti, tremblement de caméra, éclair blanc et orange en étoile, lignes de focus manga convergeant vers l'impact, onomatopée « バシッ！ » avec « CLAAAC ! » en dessous, chiffre de dégâts, étiquette « CRITIQUE ×2 ».
- **Réactions** : trace de main rouge qui s'accumule sur la joue au fil du round, gouttes et dents qui volent sur les gros coups, habitués qui sautent et lèvent leur verre, patron qui siffle les débuts de round.
- **Commentateur** : bandeau en bas d'écran avec des phrases du type « Il lui a refait le portrait ! ».

## Assets fournis

Tous les visuels du prototype existent déjà, détourés en PNG transparents, dans le pack `slap_fighter_starter.zip` à joindre à la nouvelle discussion.

| Dossier | Contenu | Conventions |
| --- | --- | --- |
| `assets/characters/bernard/` | 8 poses : idle, windup, swing, slap, hit, dazed, victory, selfslap | Image de 1300 × 823 px par pose |
| `assets/characters/lola/` | Les 8 mêmes poses, mêmes noms de fichiers | Image de 908 × 772 px par pose |
| `assets/bar/decor.png` | Salle du bar avec le ring en scotch blanc au sol | Provisoire en 4:3 (1024 × 768), remplacé ensuite par une version 16:9 |
| `assets/bar/patron.png` | Le patron arbitre, bras levé, sifflet en bouche | Recadré au plus juste, pieds en bas de l'image |
| `assets/bar/habitues/` | 8 habitués séparés : vieux\_beret, fermier, grandmere, facteur, jeune\_siffleur, mecano, boulanger, femme\_cardigan | Recadrés au plus juste, tous à la même échelle, pieds en bas de l'image |

### Règles d'utilisation des sprites de combattants

- **Sens** : toutes les poses regardent vers la droite. Le joueur de droite est affiché en miroir horizontal (`flipX`).
- **Point d'ancrage** : le centre horizontal de l'image (entre les deux pieds), et les pieds à 10 px au-dessus du bas de l'image. Ancrer en `(0.5, 1)` avec un décalage de 10 px.
- **Échelle** : Bernard et Lola sont à la même échelle en pixels. Il faut les afficher avec **le même facteur d'échelle** pour garder leur rapport de taille.
- **Changement de pose** : toutes les poses d'un perso partagent la même taille d'image et la même ligne de pieds ; on change simplement de texture, sans recalage.
- **Enchaînement d'une gifle** : windup (pendant la charge) → swing (60 ms) → slap (au moment de l'impact, avec un pas en avant) → retour à idle. Celui qui reçoit passe en hit, puis revient en idle ou passe en dazed s'il est KO.
- **Optimisation** (phase 0) : redimensionner les sprites à environ 600 px de haut et les convertir en WebP, pour des fichiers de quelques centaines de Ko au total.

### Placement dans le décor

Les combattants sont au premier plan, sur le ring. Le patron se tient au fond, au centre, entre eux. Les habitués sont alignés au fond, devant le comptoir, plus petits (environ 45 % de la taille des combattants) et légèrement assombris.

## Stack technique et dépôt

Phaser 3 + TypeScript + Vite, déployé sur GitHub Pages via GitHub Actions dans le dépôt `benjam67/soufflet` (servi sur https://benjam67.github.io/soufflet/).

| Besoin | Choix |
| --- | --- |
| Moteur de jeu | Phaser 3 (2D, tactile, animations, sons) |
| Langage et build | TypeScript + Vite |
| Hébergement | GitHub Pages, déploiement automatique à chaque push sur `main` |
| Installation sur téléphone | PWA : manifest, icône, plein écran, écran « tourne ton téléphone » en mode portrait |
| Jeu en ligne (phase 6) | PeerJS : connexion directe entre deux téléphones avec un code de salon, sans serveur à maintenir |
| Sauvegarde de la progression | `localStorage` du navigateur |
| Tests | Vitest pour la logique, Playwright pour les tests de bout en bout sur mobile émulé |

Le dépôt doit être **public** : GitHub Pages n'est gratuit que pour les dépôts publics.

### Structure du dépôt

```
slap-fighter/
  public/assets/        sprites, décor, sons (optimisés)
  src/
    config/balance.ts   toutes les valeurs de réglage
    logic/              règles pures, sans Phaser (dégâts, tours, rounds, IA)
    scenes/             Boot, Title, Fight, Result
    ui/                 barres de vie, jauge, bandeaux, onomatopées
    fx/                 impact, tremblement, particules, foule
    net/                jeu en ligne (phase 6)
  tests/unit/           Vitest
  tests/e2e/            Playwright
  ROADMAP.md            ce document
```

La logique de jeu (`src/logic/`) reste indépendante de Phaser : on peut la tester seule et simuler des matchs complets sans affichage.

## Méthode de travail et tests

Claude enchaîne les phases seul et vérifie lui-même chaque étape ; le propriétaire du projet ne joue qu'à 3 jalons : fin de la phase 2, fin de la phase 3 et fin de la phase 6.

### À chaque phase

1. Coder la phase, avec des commits réguliers sur `main`.
2. Faire passer **toutes** les vérifications ci-dessous.
3. Pousser, attendre le déploiement GitHub Pages et vérifier que la version en ligne se charge.
4. Noter dans `CHANGELOG.md` ce qui a été fait et les réglages choisis.
5. Passer à la phase suivante sans attendre, sauf aux jalons.

### Vérifications automatiques

- **Build et types** : `npm run build` sans erreur, TypeScript strict.
- **Tests unitaires (Vitest)** : formule de dégâts, zone dorée, surchauffe, chrono, enchaînement des tours, fin de round et de match, rage, sonné.
- **Simulation de matchs** : un mode `?autoplay=1` où deux IA s'affrontent. Lancer 200 matchs simulés sans affichage pour vérifier qu'un match se termine toujours, et que la durée moyenne et l'équilibre Bernard/Lola restent raisonnables (aucun perso au-dessus de 60 % de victoires).
- **Tests Playwright sur mobile émulé** : téléphone en paysage (844 × 390, tactile). Simuler un appui maintenu puis un swipe, vérifier que les PV baissent, que les poses changent et qu'il n'y a **aucune erreur dans la console**.
- **Contrôle visuel** : captures d'écran Playwright à chaque étape clé (attente, armement, impact, fin de round). Les regarder pour repérer les problèmes d'affichage : persos coupés, interface qui déborde, textes illisibles.
- **Performance** : chargement initial de moins de 3 Mo, 60 images par seconde sur mobile émulé avec ralentissement du processeur ×4.

### Quand s'arrêter pour demander

Uniquement aux 3 jalons, ou en cas de choix qui ne peut pas être annulé facilement. Les petits réglages d'équilibrage se décident seuls et sont notés dans le changelog.

## Roadmap

8 phases ; le prototype jouable à deux sur un même téléphone est prêt à la fin de la phase 2, et chaque phase n'est validée que lorsque ses critères passent.

1. **Phase 0 · Mise en place**
   - Créer le dépôt `slap-fighter`, le projet Phaser + TypeScript + Vite, Vitest et Playwright.
   - Optimiser et importer les assets (WebP, environ 600 px de haut pour les sprites).
   - Déploiement automatique sur GitHub Pages, manifest PWA, écran « tourne ton téléphone » en portrait.
   - Scène de combat statique : décor, habitués, patron, Bernard à gauche, Lola à droite en miroir, à la bonne échelle.
   - *Validé quand* : le site en ligne affiche la scène sans erreur sur mobile émulé, et la capture d'écran correspond au placement décrit dans « Assets fournis ».
2. **Phase 1 · La gifle**
   - Logique pure de la gifle dans `src/logic/` : charge, zone dorée, surchauffe, swipe (vitesse, angle), dégâts.
   - Contrôles tactiles et jauge de charge à l'écran ; enchaînement des poses windup → swing → slap → hit.
   - Pas en avant au moment de la frappe pour que la main atteigne le visage, puis retour en place.
   - Mode entraînement : on gifle Lola en boucle et on voit les dégâts.
   - *Validé quand* : les tests unitaires de la formule passent et le test Playwright « appui + swipe » fait baisser les PV.
3. **Phase 2 · Le match** (jalon : test par le propriétaire)
   - Tours alternés, chrono de 3 s, gifle molle automatique, barres de vie, 3 rounds, KO, écran de victoire.
   - Mode 2 joueurs sur un même téléphone, avec le bandeau « À TOI, … ! ».
   - *Validé quand* : 200 matchs simulés se terminent tous, sans erreur. Puis s'arrêter et envoyer le lien au propriétaire.
4. **Phase 3 · Le spectacle** (jalon : test par le propriétaire)
   - Tous les effets de la direction artistique : arrêt sur image, ralenti, tremblement, éclair, lignes de focus, onomatopées, trace de main, commentateur.
   - Habitués animés individuellement (sauts, verres levés), patron qui siffle et annonce les rounds.
   - Sons : claques, cris, sifflet, foule, musique. À défaut de fichiers fournis, sons générés en code en attendant.
   - *Validé quand* : 60 images par seconde tenues sur mobile émulé, chargement de moins de 3 Mo, captures de chaque effet vérifiées.
5. **Phase 4 · Mode solo**
   - IA à 3 niveaux, qui joue avec les mêmes règles que le joueur : précision et timing aléatoires selon le niveau.
   - *Validé quand* : par simulation, l'IA facile perd environ 70 % de ses matchs contre une IA « joueur moyen », et l'IA difficile en gagne environ 60 %.
6. **Phase 5 · Mécaniques avancées**
   - Rage, gifles spéciales (Le Battoir, La Toupie), état sonné.
   - *Validé quand* : tests unitaires de chaque mécanique OK, et l'équilibre Bernard/Lola reste dans 40–60 % de victoires sur 200 matchs simulés.
7. **Phase 6 · Jeu en ligne** (jalon : test par le propriétaire)
   - Salon avec code à 4 lettres à partager, chacun joue sur son téléphone via PeerJS.
   - Gestion des déconnexions et reprise de la partie.
   - *Validé quand* : un test Playwright à deux navigateurs joue un match complet en ligne. Puis s'arrêter et envoyer le lien au propriétaire.
8. **Phase 7 · Progression et menus**
   - Écran titre, choix du mode et du perso, XP en fin de match, déblocages (tenue streetwear de Bernard, nouveaux bars), sauvegarde en `localStorage`.
   - *Validé quand* : le parcours titre → match → résultat → déblocage passe en test Playwright, et la progression survit au rechargement de la page.

### Assets à fournir plus tard

- Décor du bar en 16:9 (remplace `decor.png`) : à intégrer dès qu'il est fourni.
- Tenue streetwear de Bernard (sans logo) et autres bars à débloquer : phase 7.
- Sons définitifs : phase 3 ou plus tard.

## Démarrer la nouvelle discussion

Joindre `slap_fighter_starter.zip` (assets + `ROADMAP.md`) au premier message, puis coller ce texte :

```text
Je veux développer le jeu mobile décrit dans ROADMAP.md (dans le zip joint, avec tous les assets).

Lis d'abord ROADMAP.md en entier, puis travaille en autonomie :
- crée le dépôt GitHub public "slap-fighter" sur mon compte connecté et mets-y les assets du zip ;
- enchaîne les phases dans l'ordre, en respectant les critères de validation de chacune ;
- teste tout toi-même (build, Vitest, simulations, Playwright sur mobile émulé, captures d'écran que tu regardes) ;
- déploie sur GitHub Pages et vérifie la version en ligne à chaque phase ;
- ne t'arrête pour me demander mon avis qu'aux jalons prévus (fin des phases 2, 3 et 6) : envoie-moi alors le lien du jeu et ce que je dois tester.

Commence par la phase 0.
```

Si la discussion devient trop longue, en ouvrir une nouvelle avec le même texte, en remplaçant la dernière ligne par « Reprends à la phase N, le dépôt slap-fighter existe déjà ». Claude relira `ROADMAP.md` et `CHANGELOG.md` dans le dépôt pour savoir où il en est.
