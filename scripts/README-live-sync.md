# Synchronisation live gratuite

Ce projet garde les donnees dans `data/matches.json`. Le script `scripts/sync_live_scores.py`
met a jour les donnees Coupe du Monde, sans exposer la cle API dans le navigateur.

## Configuration

1. Cree une cle gratuite sur API-FOOTBALL.
2. Copie `.env.example` en `.env`.
3. Remplace `ta_cle_api_football` par ta vraie cle.

## Lancer une verification

```sh
python3 scripts/sync_live_scores.py
```

Par defaut, le script n'appelle pas l'API si aucun match local n'est dans une fenetre live :
15 minutes avant le coup d'envoi jusqu'a 150 minutes apres.

## Lancer toutes les heures avec mise a jour du matin

```sh
python3 scripts/sync_live_scores.py --watch --interval-minutes 60
```

Avec le plan gratuit, cette cadence reste prudente : le script tourne toutes les heures, mais il
utilise une requete API seulement quand un match peut etre en cours.

La meme boucle fait aussi un rattrapage apres match : entre 2h45 et 6h apres le coup d'envoi,
elle verifie une fois le score final du match. Si l'API indique que le match n'est pas encore
termine, le script reessaiera au passage suivant.

En mode `--watch`, le script fait aussi une mise a jour du calendrier Coupe du Monde une fois par
jour a partir de 8h, heure de Paris. Cette passe du matin sert a corriger les horaires, statuts et
matchs a venir.

Pour changer l'heure :

```sh
python3 scripts/sync_live_scores.py --watch --interval-minutes 60 --morning-hour 9
```

Pour desactiver la passe du matin :

```sh
python3 scripts/sync_live_scores.py --watch --interval-minutes 60 --no-morning-sync
```

Pour desactiver le rattrapage apres match :

```sh
python3 scripts/sync_live_scores.py --watch --interval-minutes 60 --no-post-match-sync
```

## Mettre a jour le calendrier Coupe du Monde maintenant

```sh
python3 scripts/sync_live_scores.py --sync-upcoming
```

## Script du matin

Pour la passe quotidienne du matin, utilise ce script :

```sh
python3 scripts/morning_world_cup_sync.py
```

Il met a jour les scores des matchs termines et les matchs a venir de la Coupe du Monde.
Il garde une memoire dans `data/sync-state.json` pour ne pas consommer une nouvelle requete si
la sync du jour a deja ete faite.

Pour relancer quand meme :

```sh
python3 scripts/morning_world_cup_sync.py --force-today
```

La competition ciblee est configuree dans `.env` :

```sh
API_FOOTBALL_WORLD_CUP_LEAGUE=1
API_FOOTBALL_WORLD_CUP_SEASON=2026
```

Attention : au test du 24 juin 2026, API-FOOTBALL a indique que le plan gratuit n'a pas acces
a la saison 2026 de la Coupe du Monde. Dans ce cas, le script s'arrete avec l'erreur API au lieu
d'ecrire une fausse mise a jour vide.

## Tester sans modifier le fichier

```sh
python3 scripts/sync_live_scores.py --dry-run
```

## Forcer un appel API

```sh
python3 scripts/sync_live_scores.py --force --dry-run
```
