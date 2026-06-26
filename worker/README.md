# Worker live — données temps réel (Cloudflare)

Sert **toutes** les données de l'app (matchs live, classements, cotes, joueurs)
depuis Cloudflare KV. Deux environnements **isolés** : `preprod` et `production`.

## Architecture

```
Python (GitHub Actions, 10h UTC)
   calcule matches / standings / odds / players
   └─ push dans le KV de chaque env :  matches:base, standings, players, odds

Worker (1 par env, cron 1 min)
   • matin (>= RESEED_HOUR_UTC) : adopte matches:base  -> matches:current
   • match live                 : merge scores/minute  -> matches:current
   • rien en cours              : ne fait rien
   • GET /            -> matches:current   (fallback matches:base)
   •     /standings /players /odds -> tels quels depuis le KV

Frontend (Cloudflare Pages)
   • preprod (branche main) : preprod.lacoteadede.fr -> Worker preprod
   • prod    (branche prod) : lacoteadede.fr         -> Worker prod
   • choisit le Worker selon le domaine (voir DATA_WORKERS dans app.js)
```

## Environnements

| Env | Worker | KV | Origines (CORS) | Domaine |
|---|---|---|---|---|
| `preprod` | `pari-sportif-live-preprod` | preprod | github.io + preprod.lacoteadede.fr | preprod.lacoteadede.fr |
| `production` | `pari-sportif-live-prod` | prod | lacoteadede.fr (+ www) | lacoteadede.fr |

Les ids KV et origines sont dans [`wrangler.toml`](wrangler.toml).

## Déploiement

Automatique via GitHub Actions ([`.github/workflows/deploy-worker.yml`](../.github/workflows/deploy-worker.yml)) :
- push sur **`main`** touchant `worker/` → déploie **preprod**
- push sur **`prod`** touchant `worker/` → déploie **production**

### Réglages one-time par environnement

1. **KV** : un namespace par env (ids dans `wrangler.toml`).
2. **Secret API** : `API_FOOTBALL_KEY` à définir une fois par Worker
   (dashboard → Worker → Settings → Variables and Secrets → type *Secret*).
   Il survit aux redéploiements.

### Déploiement manuel (optionnel)

```sh
cd worker
npx wrangler deploy --env preprod
npx wrangler deploy --env production
npx wrangler secret put API_FOOTBALL_KEY --env preprod
```

## Données

Poussées par GitHub Actions ([`update-data.yml`](../.github/workflows/update-data.yml))
vers le KV des deux environnements après la passe Python quotidienne. Clés KV :
`matches:base`, `standings`, `players`, `odds`.

## Debug

```sh
npx wrangler tail --env preprod
curl https://pari-sportif-live-preprod.<sous-domaine>.workers.dev/        # matches
curl https://pari-sportif-live-preprod.<sous-domaine>.workers.dev/standings
```
