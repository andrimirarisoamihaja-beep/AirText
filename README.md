# KORAGNA

Messagerie instantanée **anonyme, éphémère, chiffrée de bout en bout, pair-à-pair**.
Aucun compte. Aucune inscription. Aucune base de données de messages.

## Principe

1. **Créer** : pseudo + code + timer (15 min → 7 j). L'app génère un lien / QR d'invitation.
   Le secret voyage dans le **fragment** (`#`) du lien : jamais envoyé au serveur.
2. **Attendre** : la salle vit 1 h maximum sur l'annuaire éphémère. Sans visiteur → destruction.
3. **Rejoindre** : pseudo + code (ou lien/QR) → handshake WebRTC → canal DataChannel chiffré.
4. **Discuter** : texte + images (compressées, fragmentées, vérifiées par SHA-256).
   Le timer ne peut jamais être réduit ; prolongation par accord mutuel uniquement.
5. **Détruire** : timer écoulé, Nuke ou fin explicite → tout est effacé des deux côtés.

## Architecture

| Couche | Détail |
| --- | --- |
| Frontend | Next.js (App Router), mobile-first, PWA (manifest + service worker), CSP stricte, zéro tracker |
| Signalisation | `POST /api/signal` — annuaire **en mémoire vive** (TTL 1 h attente, purge post-connexion), relai SDP/ICE uniquement, long-polling |
| Transport | WebRTC DataChannel (texte + binaire). Aucun contenu ne traverse le serveur |
| Crypto | Web Crypto native : HKDF(pseudo+code) → AES-GCM 256, ECDH P-256 éphémère par session (PFS), IV aléatoire 96 bits |
| Stockage local | IndexedDB chiffré (métadonnées de sessions vivantes uniquement). Messages : mémoire vive seule, jamais persistés |

## Fichiers clés

```
src/server/signaling.ts        annuaire éphémère (TTL, sweeps, waiters)
src/app/api/signal/route.ts    relai SDP/ICE — actions create/join/answer/candidate/poll/connected/reset/close
src/lib/crypto.ts              HKDF/SHA-256/ECDH/AES-GCM, dérivations d'identité
src/lib/rtc.ts                 sessions WebRTC, chunking images, timers, extension mutuelle, nuke
src/lib/store.ts               état multi-conversations (zustand) + persistance chiffrée
src/lib/idb.ts                 IndexedDB minimal
src/lib/image.ts               compression Canvas
src/app/{create,join,chat}     flux utilisateur
```

## Déploiement gratuit

- Tout hébergeur Node/Serverless : `npm run build && npm start` (ou Vercel/Railway/Render).
- **HTTPS obligatoire** (Web Crypto + WebRTC exigent un contexte sécurisé).
- Un seul processus Node : l'annuaire est volontairement en RAM (aucune persistance à provisionner).
- STUN configurable : `NEXT_PUBLIC_STUN_URLS=stun:host1,stun:host2` (défaut : STUN public Google).
- Pour scaler horizontalement, remplacer la Map en mémoire par un store à TTL (Redis/KV) — le contenu resterait hors serveur.

## Limites connues

- WebRTC P2P peut révéler votre IP publique à l'autre participant (VPN/Tor recommandé).
- Recharger la page conserve la session, pas l'historique des messages (par conception).
- Images ≤ 5 Mo après compression (max 1600 px).
- Multi-conversations simultanées dans un même onglet ; éviter le même salon dans plusieurs onglets.
- Salle d'attente : expiration stricte à 1 h.
- Anonymat total = aucune modération ; la responsabilité appartient aux utilisateurs.

## Recommandations de sécurité

- Comparez l'**empreinte visuelle** (barres colorées dans l'en-tête du chat) avec votre pair.
- Partagez le code par un canal séparé si possible.
- Maintenez le navigateur à jour ; utilisez le mode navigation privée si l'appareil est partagé
  (le stockage local y est effacé à la fermeture).
