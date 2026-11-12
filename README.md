# Cockpit – mon suivi course / trail / muscu

Appli perso pour téléphone qui analyse mes activités Strava.
**Ce dépôt ne contient aucune donnée.** Les données vivent dans `cockpit-data.json` sur mon Google Drive. Un script Google Apps Script, privé et dans mon compte, les met à jour depuis Strava.

```
Strava ──► Script Google (toutes les 15 min + à chaque ouverture de l'appli) ──► cockpit-data.json (Drive)
                                         ▲                                              │
                                         └──────── appli Cockpit (clé secrète) ◄────────┘
```

## Installer l'appli
Ouvrir https://aledogar51-svg.github.io/Cockpit_coach/ dans Chrome, puis bouton **Installer** (ou menu ⋮ → *Installer l'application*).

## Brancher Strava (une seule fois, plus simple sur ordinateur)

**A. Créer l'application Strava**
1. https://www.strava.com/settings/api → créer une application.
2. Nom `Cockpit`, catégorie *Training*, site `https://aledogar51-svg.github.io/Cockpit_coach/`, **Authorization Callback Domain : `localhost`**.
3. Noter le **Client ID** et le **Client Secret**.

**B. Repérer le fichier Drive**
Dans Drive, sur `cockpit-data.json` : *Partager → Copier le lien*. Le fichier peut rester privé, le lien sert juste à trouver son identifiant.

**C. Créer le script**
1. https://script.google.com → *Nouveau projet* → le renommer « Cockpit Strava ».
2. Remplacer tout le contenu par [`apps-script/Code.gs`](apps-script/Code.gs).
3. En haut, remplir `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` et `DRIVE_FILE_ID` (le lien copié suffit), puis enregistrer (💾).

**D. Lancer les 3 étapes** (menu déroulant de fonctions → ▶ *Exécuter*, résultat dans le *Journal d'exécution*)
1. `etape1_lienStrava` : Google demande des autorisations la 1re fois (*Paramètres avancés → Accéder à Cockpit Strava*). Ouvrir le lien affiché et cliquer *Autoriser*. La page qui suit ne charge pas, c'est normal. Copier dans la barre d'adresse la valeur après `code=` (jusqu'à `&scope`). La coller dans `CODE_STRAVA`, puis enregistrer.
2. `etape2_connecterStrava` : affiche « ✅ Connecté à Strava ».
3. `etape3_installer` : installe la synchro toutes les 15 min, fait une 1re synchro et affiche ta **clé secrète** 🔑.

**E. Publier le script pour l'appli**
*Déployer → Nouveau déploiement → ⚙ Application Web*. *Exécuter en tant que : Moi*, *Qui a accès : Tout le monde* → *Déployer* → copier l'**URL de l'application Web**.
(« Tout le monde » est nécessaire pour que l'appli puisse l'appeler, mais sans la clé secrète le script ne renvoie rien.)

**F. Dans l'appli** : ⚙ Réglages → coller l'URL et la clé → *Enregistrer*.

Ensuite, à chaque ouverture, l'appli récupère tes nouvelles activités Strava. ↻ force une synchro.

**G. (Une fois) Remise à niveau** : lancer `remiseANiveau` dans le script. Importe tout l'historique Strava avec le cardio, retire les activités supprimées et recalcule les records (par lots, en quelques heures si l'historique est long).
Ensuite, chaque jour, le script retire tout seul les activités supprimées sur Strava.

**Objectif de course** : ⚙ Réglages → *Mon objectif* (course, date, temps visé, sorties par semaine). Ces infos restent sur le téléphone.

## Muscu (détail des séries)
L'API Strava ne permet pas de lire les séries de musculation. Claude les récupère via sa connexion Strava et dépose un fichier `cockpit-muscu*.json` sur le Drive (tâche planifiée chaque nuit). Le script l'intègre dans `cockpit-data.json` (clés `exercises` et `muscu`) à la synchro suivante, puis le met à la corbeille.
Historique : déposer `cockpit-muscu-historique.json` n'importe où dans le Drive.
Format : `{ type: "cockpit-muscu", exercises: { "Bench Press": ["Chest","Triceps","Shoulders"] }, workouts: [ { id, date, sets: [[exercice, kg|null, reps, nb_séries]] } ] }`

## Si je modifie le script plus tard
*Déployer → Gérer les déploiements → ✏ → Version : Nouvelle version → Déployer* (l'URL ne change pas).

## Format des données
`activities[]` : `id, name, type, start, km, sec, elapsed, dplus, cad, hr, hr_max, re, kcal, max_kmh, desc, race, goal_sec`
`records[]` : `label, sec, date, activity_id` · `next_race` : `{ name, date, km, dplus, goal }` ou `null`
Ajouts à la main conservés par le script : `race: true`, `goal_sec`, `next_race`.
