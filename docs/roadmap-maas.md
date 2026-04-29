# TransportViz — Roadmap MaaS

## Vision

App de mobilite multimodale en Ile-de-France avec deux differenciateurs cles :
1. **Visibilite temps reel** : voir ses vehicules (train, bus, tram, velo) en direct sur la carte
2. **Intelligence de fiabilite** : savoir quel trajet est vraiment fiable, pas juste le plus rapide

## Architecture cible

```
Frontend (React + Vite + Leaflet)
  - Carte temps reel tous modes
  - Itineraires multimodaux
  - Dashboard "mon trajet"
  - PWA (installable, notifications)

Backend (Node.js/Express)
  - GTFS tous modes (RER, Transilien, metro, bus, tram)
  - PRIM API temps reel (stop-monitoring, general-message)
  - GBFS (Velib', trottinettes)
  - Proxy routing (Navitia API ou OpenTripPlanner)
  - Stats de fiabilite (stockage + cron)
  - Suivi itineraire en cours
```

## Phases

### Phase 1 — Elargir les modes
Ajouter bus, tram, metro et Velib' a la carte temps reel existante.

**Objectifs :**
- GTFS bus/tram/metro (meme format, plus de donnees)
- Positions temps reel bus/tram via PRIM (meme API stop-monitoring)
- Velib' temps reel (GBFS feed — un JSON a fetcher)
- Icones differentes sur la carte par mode (bus, tram, metro, velo)
- Filtres par mode sur la carte

**Sources de donnees :**
- GTFS IDF : meme feed, filtrer route_type (0=tram, 1=metro, 3=bus)
- PRIM stop-monitoring : memes endpoints, fonctionne pour tous les modes
- Velib' GBFS : https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/gbfs.json

### Phase 2 — Itineraires multimodaux
Integrer un moteur de routing externe pour proposer des trajets.

**Objectifs :**
- Integrer Navitia API (api.navitia.io) comme moteur de routing
- Afficher l'itineraire sur la carte avec les vehicules en temps reel dessus
- Proposer 3 alternatives : rapide / fiable / meilleur maintenant
- Clic sur une etape = zoom sur le vehicule

**Moteur de routing :**
- Option A : Navitia API (gratuit jusqu'a ~10k req/jour, deja IDF integre)
- Option B : OpenTripPlanner self-hosted (plus de controle, cout serveur)
- Recommandation : commencer Navitia, migrer OTP si besoin

### Phase 3 — Intelligence et fiabilite
Construire les stats de fiabilite a partir des donnees temps reel.

**Objectifs :**
- Cron job : logger retards toutes les 5 min (stockage BDD)
- Stats de fiabilite par mission / ligne / tranche horaire
- Score de fiabilite dans les resultats d'itineraire
- "Meilleur train" pour un trajet donne
- Historique : "cette semaine, le RER A a eu X% de retards"

### Phase 4 — Companion de trajet
Transformer l'app en assistant de mobilite quotidien.

**Objectifs :**
- Trajets sauvegardes (2-3 trajets reguliers)
- Dashboard "mon quotidien" : etat du reseau pour MES lignes chaque matin
- Itineraire vivant : recalcul en cours de route si retard
- Alertes personnalisees : "ton train de 8h12 est supprime"
- Prediction de correspondances : "tu vas rater ta correspondance, voici une alternative"
- PWA + service worker pour notifications push
- Bilan hebdo des trajets

## Positionnement vs concurrence

| App | Forces | Faiblesses |
|-----|--------|------------|
| IDFM | Officielle, complete | UX lourde, pas de carte RT |
| Citymapper | Super UX, multimodal | Pas de positions vehicules, pas de fiabilite |
| Google Maps | Universel | Generique, pas de RT vehicules |
| Carto Tchoo | Carte trains | Pas d'itineraires, pas interactif |
| **TransportViz** | Carte RT + itineraires + fiabilite + alternatives | A construire |
