# Slap Fighter

Jeu de gifles façon jeu de combat anime des années 90, jouable sur mobile (PWA, paysage).

**Jouer** : https://benjam67.github.io/soufflet/

- Feuille de route : [ROADMAP.md](ROADMAP.md)
- Avancement et réglages : [CHANGELOG.md](CHANGELOG.md)

## Développement

```bash
npm install
npm run dev        # serveur local
npm test           # tests unitaires (Vitest)
npm run test:e2e   # tests Playwright sur mobile émulé (build + preview)
BASE_URL=https://benjam67.github.io/soufflet/ npm run test:e2e   # contre la version en ligne
npm run assets     # régénère public/assets/ depuis raw/
```
