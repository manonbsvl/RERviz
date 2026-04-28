# RERviz Deployment Guide

## Vue d'ensemble

RERviz est déployé sur **Vercel** avec deux applications distinctes :
- **Backend** : Serverless Functions (Node.js)
- **Frontend** : Static Site (Vite + React)

## Configuration Vercel

### Backend
- **Root Directory** : `backend/`
- **Build Command** : Aucun (Vercel détecte les Serverless Functions)
- **Output Directory** : `.`
- **Environment Variables** :
  - `NODE_ENV` : `production`

### Frontend
- **Root Directory** : `frontend/`
- **Build Command** : `npm run build`
- **Output Directory** : `dist`
- **Environment Variables** :
  - `VITE_API_URL` : URL du backend déployé

## Étapes de déploiement

1. **Déployer le Backend**
   ```bash
   cd backend
   npm install
   vercel deploy --prod
   ```
   Noter l'URL du backend (ex: `https://rerviz-backend.vercel.app`)

2. **Mettre à jour l'URL du Frontend**
   Modifier `frontend/.env.production` avec l'URL du backend :
   ```
   VITE_API_URL=https://rerviz-backend.vercel.app
   ```

3. **Déployer le Frontend**
   ```bash
   cd frontend
   npm install
   vercel deploy --prod
   ```

## Variables d'environnement

### Frontend

**Development** (`.env.development`)
```
VITE_API_URL=http://localhost:3000
```

**Production** (`.env.production`)
```
VITE_API_URL=https://rerviz-backend.vercel.app
```

### Backend

Backend utilise `dotenv` pour charger `.env`. Voir `.env.example` pour les variables disponibles.

## Commandes utiles

```bash
# Development local
cd backend && npm run dev  # Terminal 1
cd frontend && npm run dev # Terminal 2

# Build production
npm run build

# Prévisualisation production
npm run preview
```

## Troubleshooting

- **Erreurs CORS** : Vérifier que CORS est activé dans `backend/src/server.js`
- **API non accessible** : Vérifier `VITE_API_URL` dans `.env.production`
- **Build failure** : Vérifier les logs Vercel dans le dashboard
