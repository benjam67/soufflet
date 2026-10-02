# Slap Fighter

Jeu de gifles façon jeu de combat anime des années 90, jouable sur mobile (PWA, paysage).

**Jouer** : https://benjam67.github.io/soufflet/

- Feuille de route : [ROADMAP.md](ROADMAP.md)
- Avancement et réglages : [CHANGELOG.md](CHANGELOG.md)

## Modes

- **Solo** contre une IA (facile, normal, difficile), **2 joueurs** sur le même téléphone, **en ligne** avec un code de salon à 4 lettres, **entraînement**.
- En combat : maintenir pour armer, glisser vers l'adversaire (garder le doigt posé = feinte) ; glisser vers l'arrière à l'impact = esquive ; rage pleine : glisser vers le haut = spéciale, vers le bas en défense = garde de rage.
- Accès direct par l'URL : `?mode=solo&level=easy|normal|hard`, `?mode=match`, `?mode=online`, `?join=CODE`, `?mode=training`, `?autoplay=1` (démo IA).

## Développement

```bash
npm install
npm run dev        # serveur local
npm test           # tests unitaires (Vitest)
npm run test:e2e   # tests Playwright sur mobile émulé (build + preview)
BASE_URL=https://benjam67.github.io/soufflet/ npm run test:e2e   # contre la version en ligne
npm run assets     # régénère public/assets/ depuis raw/
npm run sim        # rapport d'équilibrage (matchs IA contre IA)
npm run music -- sortie.wav   # rend la musique en fichier
```
