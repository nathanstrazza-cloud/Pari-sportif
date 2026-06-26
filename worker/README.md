# Worker live — scores temps réel (Cloudflare)

Met à jour les scores des matchs **chaque minute** via un cron Cloudflare, sans
toucher à GitHub Pages ni faire de commit. Le calendrier de base reste géré par
la passe Python du matin (`.github/workflows/update-data.yml`).

## Comment ça marche

Le cron tourne chaque minute et choisit **une** des trois branches :

```
1. Matin (1x/jour, après RESEED_HOUR_UTC) ─► re-seed depuis Pages
      (adopte le calendrier finalisé par la passe Python : matchs à venir + scores passés)
2. Match live en cours                    ─► API-FOOTBALL live=all
      ─► applique score / statut / minute sur l'état accumulé (src/merge.ts)
3. Rien en cours                          ─► ne fait rien (0 appel API, 0 écriture KV)

Frontend ─► GET /  : lit le KV (+ en-tête CORS), fallback sur Pages si KV vide
```

- **Le KV est l'état accumulé** : les scores finaux y **persistent** (pas écrasés par le
  calendrier de base), jusqu'au re-seed du lendemain matin.
- Hors live : **aucun appel API**, **aucune écriture**.
- Clé API jamais exposée au navigateur (secret Cloudflare).
- La passe du matin (matchs à venir, scores de la veille, classements, cotes) reste gérée
  par `scripts/morning_world_cup_sync.py` (GitHub Actions, quotidien). Le Worker se contente
  d'**adopter** son résultat via le re-seed.

## Déploiement (une fois)

Prérequis : Node installé.

```sh
cd worker
npm install
npx wrangler login

# 1) Créer le store KV et copier l'id affiché dans wrangler.toml (champ id =)
npx wrangler kv namespace create MATCHES

# 2) Enregistrer la clé API-FOOTBALL en secret (pas dans le fichier)
npx wrangler secret put API_FOOTBALL_KEY

# 3) Déployer
npx wrangler deploy
```

`wrangler deploy` affiche l'URL publique, par ex. :
`https://pari-sportif-live.<ton-sous-domaine>.workers.dev`

## Dernière étape

Coller cette URL dans `app.js` :

```js
const LIVE_DATA_URL = "https://pari-sportif-live.<ton-sous-domaine>.workers.dev";
```

Puis commit + push. Tant que `LIVE_DATA_URL` est `""`, l'app utilise uniquement
`data/matches.json` (le live est désactivé, rien ne casse).

## Vérifier / déboguer

```sh
npx wrangler tail            # logs en direct du cron et des requêtes
curl https://pari-sportif-live.<ton-sous-domaine>.workers.dev | head
```

## Variables (wrangler.toml)

| Variable | Rôle |
|---|---|
| `WORLD_CUP_LEAGUE` / `WORLD_CUP_SEASON` | compétition ciblée API-FOOTBALL |
| `SCHEDULE_URL` | calendrier de base (matches.json sur Pages) |
| `ALLOWED_ORIGIN` | origine autorisée CORS (l'URL du site) |
| `API_FOOTBALL_KEY` | **secret**, via `wrangler secret put` |
