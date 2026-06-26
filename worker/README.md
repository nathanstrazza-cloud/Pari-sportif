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
| `preprod` | `coteadede-preprod` | preprod | github.io + preprod.lacoteadede.fr | preprod.lacoteadede.fr |
| `production` | `coteadede-prod` | prod | lacoteadede.fr (+ www) | lacoteadede.fr |

Les ids KV et origines sont dans [`wrangler.toml`](wrangler.toml).

## Déploiement

Automatique via GitHub Actions ([`.github/workflows/deploy-worker.yml`](../.github/workflows/deploy-worker.yml)) :
- push sur **`main`** touchant `worker/` → déploie **preprod**
- push sur **`prod`** touchant `worker/` → déploie **production**

### Réglages one-time par environnement

1. **KV** : un namespace par env (ids dans `wrangler.toml`).
2. **Secret `API_FOOTBALL_KEY`** : sur **chaque** Worker (preprod **et** prod), car les deux
   font le merge live (prod via cron, preprod via `/sync`).
3. **Secret `SYNC_TOKEN`** : sur chaque Worker (protège l'endpoint `/sync`), et le même
   en secret GitHub (le workflow l'utilise pour déclencher le live).
   (dashboard → Worker → Settings → Variables and Secrets → type *Secret*.)

### Endpoint /sync

`POST /sync?token=<SYNC_TOKEN>` relance le merge live à la demande (repart de `matches:base`,
applique le live, écrit `matches:current`). C'est ce que le bouton GitHub appelle pour
rafraîchir le **live** en preprod. Le merge live n'existe donc **qu'en TS** (pas de doublon Python).

### Déploiement manuel (optionnel)

```sh
cd worker
npx wrangler deploy --env preprod
npx wrangler deploy --env production
npx wrangler secret put API_FOOTBALL_KEY --env preprod
```

## Données — auto en prod, manuel en preprod

| Env | Live (cron Worker) | Push données (Python) |
|---|---|---|
| `production` | auto, 1 min | auto, run planifié quotidien |
| `preprod` | **aucun** | **manuel uniquement** |

- **Prod** se rafraîchit toute seule (cron 1 min + push quotidien).
- **Preprod** ne bouge **que** sur demande : Actions → **Update data** → *Run workflow*
  → `target = preprod` (ou `both`). Pratique pour tester l'app sur un jeu de données figé.

Clés KV poussées par [`update-data.yml`](../.github/workflows/update-data.yml) :
`matches:base`, `standings`, `players`, `odds`.

## Debug

```sh
npx wrangler tail --env preprod
curl https://coteadede-preprod.<sous-domaine>.workers.dev/        # matches
curl https://coteadede-preprod.<sous-domaine>.workers.dev/standings
```
