# Cockpit – mon suivi course / trail / muscu

Page perso (mobile) qui analyse mes activités Strava.  
**Ce dépôt ne contient aucune donnée.** Les données vivent dans un fichier `cockpit-data.json` sur mon Google Drive et ne sont lues que depuis mon téléphone, après connexion Google.

## Mise en ligne (GitHub Pages)
1. Déposer uniquement `index.html` dans le dépôt (jamais le fichier `.json`).
2. Settings → Pages → Source : *Deploy from a branch* → `main` / `root`.
3. La page est servie sur `https://<mon-pseudo>.github.io/<nom-du-depot>/`.

## Synchro Google Drive (une seule fois)
1. https://console.cloud.google.com → nouveau projet « Cockpit ».
2. *API et services → Bibliothèque* → activer **Google Drive API**.
3. *Écran de consentement OAuth* → Externe, mode **Test**, ajouter mon adresse Gmail comme utilisateur test.
4. *Identifiants → Créer → ID client OAuth* → Application Web → *Origines JavaScript autorisées* : `https://<mon-pseudo>.github.io`.
5. Sur la page : ⚙ Réglages → coller l'ID client et le lien de partage du fichier Drive (le fichier peut rester privé).

Sans ces réglages, le bouton ↻ ouvre le sélecteur de fichiers du téléphone (Drive y est accessible).

## Format des données
`activities[]` : `id, name, type, start, km, sec, elapsed, dplus, cad, re, kcal, max_kmh, desc, race, goal_sec`  
`records[]` : `label, sec, date, activity_id` · `next_race` : `{ name, date, km, dplus, goal }` ou `null`
