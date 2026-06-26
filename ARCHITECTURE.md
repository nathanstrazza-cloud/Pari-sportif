# Architecture — Pari sportif

Application PWA (Coupe du Monde) avec des données **statiques** (calendrier, classements,
cotes, joueurs, cartes) et des données **live** (scores en match). Le tout est servi depuis
**Cloudflare**, en deux environnements isolés : **prod** et **preprod/dev**.

## Flux des données

```
                         ┌──────────────────────┐
                         │     API-FOOTBALL      │  source externe
                         └─────────┬─────┬───────┘
            classements/cotes      │     │      scores live
                    ┌──────────────┘     └──────────────┐
                    ▼                                    ▼
        ┌───────────────────────┐          ┌───────────────────────────┐
        │ GitHub Actions · Python│          │  Cloudflare Worker · TS    │
        │  DONNÉES STATIQUES     │          │  LIVE + APRÈS-MATCH         │
        │  (batch : matin/bouton)│          │  cron 1 min · /sync         │
        └───────────┬───────────┘          └─────────────┬─────────────┘
              push   │                       écrit / lit  │
                     ▼                                    ▼
              ┌──────────────────────────────────────────────────┐
              │            Cloudflare KV — store                  │
              │  matches:base · matches:current · standings ·      │
              │  players · odds · cards   (1 namespace par env)    │
              └──────────────────────────────────────────────────┘
                                   ▲
                                   │ le Worker LIT le KV et sert /endpoints
                                   │
        ┌──────────────────┐      │      ┌──────────────────────────────┐
        │ Pages (héberge   │ app  │      │      Navigateur · app.js       │
        │ l'app HTML/CSS/JS)├──shell──────►  lit le Worker selon le domaine│
        │ Cloudflare / GitHub│            │  poll 30 s en live · PWA · repli│
        └──────────────────┘            └──────────────────────────────┘
```

## Les composants

### Cloudflare Worker (`worker/src/index.ts`) — cœur temps réel (TypeScript)

Une instance **par environnement**. Deux rôles :

**1. Producteur live (cron `* * * * *`, prod uniquement)** — fonction `syncLive`, 4 branches :
1. **Matin** (≥ `RESEED_HOUR_UTC`) : adopte `matches:base` (ce que Python a finalisé) → `matches:current`.
2. **Match live** : appel `live=all` → merge score/minute/statut → `matches:current`.
3. **Après-match** (de +135 à +195 min, toutes les 10 min) : requête ciblée par id pour
   récupérer le **score final** (un match terminé ne ressort plus dans `live=all`).
4. **Sinon** : rien (aucun appel API, aucune écriture).

**2. API de lecture (`fetch`)** — sert les données au frontend (voir section suivante).
Plus `POST /sync?token=…` qui relance le merge live **à la demande** (utilisé par la preprod).

### GitHub Actions · Python (`.github/workflows/update-data.yml`) — batch statique

Calcule ce qui n'a pas besoin de temps réel (calendrier/finals, classements, cotes, joueurs,
cartes) via `scripts/*.py`, puis **pousse les JSON dans le KV** (API Cloudflare).
Déclenché **automatiquement le matin** (prod) ou **par bouton manuel** (preprod).

### Cloudflare KV — stockage

Un blob JSON par clé. **1 namespace isolé par environnement.**

| Clé | Contenu | Écrite par |
|-----|---------|-----------|
| `matches:base` | calendrier + scores finalisés | Python |
| `matches:current` | base + overlay live (c'est ce qui est servi) | Worker |
| `standings` `players` `odds` `cards` | données statiques | Python |

### Navigateur (`app.js`) — UI

- Détecte l'environnement par le **domaine** (`DATA_BASE` = Worker prod ou preprod).
- Charge **tout depuis le Worker**, avec **repli** sur `data/*.json` si le Worker est injoignable.
- **Re-poll toutes les 30 s** en live (3 min sinon) → mise à jour automatique de l'écran. PWA.
- L'app (HTML/CSS/JS) est servie par **Pages** (Cloudflare en prod, GitHub en dev).

## Comment le Worker sert les données

Le `fetch` du Worker est un **simple lecteur de KV** — il ne calcule **rien** à la lecture
(tout le calcul est fait côté écriture : cron, Python, `/sync`). Étapes d'une requête :

```
GET https://pari-sportif-live-prod.<sous-domaine>.workers.dev/standings
```

1. **CORS** : `pickOrigin` compare l'`Origin` de la requête à l'allowlist `ALLOWED_ORIGINS`
   et la renvoie si elle est autorisée (sinon la 1ʳᵉ de la liste). Une requête `OPTIONS`
   (préflight) repart immédiatement avec les en-têtes CORS.
2. **Routage par chemin** : le pathname est nettoyé (`/standings` → `standings`) puis mappé :
   - `""` ou `matches` → clé KV `matches:current`
   - `standings` / `players` / `odds` / `cards` → la clé du même nom
   - `sync` → endpoint d'écriture protégé par token (pas une lecture)
   - tout le reste → `404`
3. **Lecture KV** : `env.MATCHES.get(key)`. Cas spécial : si `matches:current` est vide
   (avant le 1er cron), on **retombe sur `matches:base`** pour servir quand même le calendrier.
4. **Réponse** : le blob JSON tel quel, avec les en-têtes :
   - `Content-Type: application/json; charset=utf-8`
   - en-têtes **CORS** (origine autorisée + `Vary: Origin`)
   - `Cache-Control: public, max-age=15` (cache court ; le frontend re-poll de toute façon).

Conséquences : une lecture est **rapide et quasi gratuite** (un simple `KV.get` au plus près
de l'utilisateur via le réseau Cloudflare), et la fraîcheur des scores ne dépend que de la
**vitesse d'écriture** (cron 1 min en prod, `/sync` à la demande en preprod).

## Deux environnements

| | Prod (`lacoteadede.fr`) | Preprod / dev |
|---|---|---|
| Worker | `pari-sportif-live-prod` (cron 1 min) | `pari-sportif-live-preprod` (pas de cron) |
| Données | **automatiques** (cron live + push quotidien) | **manuelles** (bouton *Update data*) |
| Live | cron du Worker | `/sync` du Worker, déclenché par le bouton |
| KV / Pages | namespace + projet dédiés | namespace + projet dédiés |

Voir [`worker/README.md`](worker/README.md) pour le déploiement et les secrets.
