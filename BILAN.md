# GhettoPay — Bilan du projet

> Dernière mise à jour : 23 avril 2026

---

## Ce qu'on a

### Code & Architecture

| Fichier | Contenu | Lignes |
|---|---|---|
| `index.html` | HTML pur | ~1 127 |
| `styles.css` | Tout le CSS extrait | 1 033 |
| `utils.js` | Helpers (`f`, `$`, `esc`) + validateurs (`validateAmount`, `validatePhone`, `validateName`, `tryCatch`) | ~35 |
| `state.js` | Gestion localStorage avec préfixe `gp3_` | ~8 |
| `api.js` | Client Supabase | ~5 |
| `main.js` | Toute la logique métier, écrans, routing | 3 414 |
| `sw.js` | Service worker PWA (cache offline) | ~42 |
| `tests/` | 32 tests Vitest (utils + business logic) | — |

### Sécurité

- Credentials admin hardcodés supprimés de `admin.html`
- XSS corrigé — `esc()` appliqué sur toutes les injections de données utilisateur
- PIN lockout — verrouillage 30s après 5 tentatives échouées
- PIN par défaut `1234` supprimé

### PWA

- Manifest complet (`id`, `scope`, `dir`, `display_override`, `screenshots`)
- Icônes PNG générées : `icon-192.png`, `icon-512.png`
- 3 captures d'écran liées (828×1792)
- Service worker enregistré (cache offline)

### Play Store

- AAB signé généré via PWABuilder
- Keystore `signing.keystore` — **à conserver précieusement**
- `assetlinks.json` câblé avec le SHA-256 réel (`97:AB:31:...`)
- Politique de confidentialité hébergée : `https://ghettopay-app.vercel.app/privacy.html`

---

## Ce qu'il manque

### Bloquant — Publication Play Store

- [ ] **Compte développeur Google Play** — 25 USD (paiement unique) sur play.google.com/console
- [ ] **Uploader l'AAB** dans Play Console (Production ou Test interne)
- [ ] **Fiche Play Store** à remplir :
  - Description courte (80 caractères max)
  - Description longue (4 000 caractères max)
  - Catégorie : Finance
  - Email de contact
- [ ] **Déclaration de sécurité des données** (formulaire Google — quelles données sont collectées, où elles vont)
- [ ] **Classification IARC** (questionnaire d'âge dans Play Console — ~5 minutes)

### Architecture (non bloquant)

- [ ] `main.js` reste un monolithe de 3 400 lignes — pas de séparation par écran
- [ ] Pas de store d'état centralisé (les données passent par `S` + variables globales)
- [ ] `onclick="G.*"` inline dans le HTML — fort couplage markup/logique
- [ ] Pas de tests d'intégration (on ne teste que les calculs purs)

### Fonctionnalités (roadmap)

- [ ] Notifications push (Firebase ou OneSignal)
- [ ] Mode hors-ligne complet (sync différée des transactions échouées)
- [ ] Version iOS — App Store (99 USD/an, processus séparé)
- [ ] Virement bancaire réel (intégration opérateur mobile money Gabon)

---

## Informations importantes

| Élément | Valeur |
|---|---|
| URL de production | https://ghettopay-app.vercel.app |
| Politique de confidentialité | https://ghettopay-app.vercel.app/privacy.html |
| Package Android | `app.vercel.ghettopay_app.twa` |
| SHA-256 keystore | `97:AB:31:90:22:32:D4:50:D5:78:7C:4C:4D:D4:20:60:38:47:86:6A:E0:B8:F5:13:7F:9D:FB:CD:47:E6:A4:26` |
| Repo GitHub | https://github.com/nsoley20/ghettopay-app |

---

## Prochaine action immédiate

Créer le compte développeur sur **play.google.com/console** (25 USD) — c'est le seul déblocage nécessaire pour soumettre l'app.
