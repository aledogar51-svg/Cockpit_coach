/**
 * COCKPIT – Synchro Strava → Google Drive
 * ----------------------------------------
 * À coller dans un projet Google Apps Script (script.google.com).
 * Ce script :
 *   1. récupère tes activités Strava (nouvelles + modifiées),
 *   2. met à jour le fichier cockpit-data.json sur ton Google Drive,
 *   3. répond à l'appli Cockpit (avec ta clé secrète) pour qu'elle affiche des données fraîches.
 *
 * Tes identifiants restent dans TON compte Google : rien n'est publié sur GitHub.
 */

// ====== À REMPLIR ======================================================
const STRAVA_CLIENT_ID     = '';   // ex : '123456'  (strava.com/settings/api)
const STRAVA_CLIENT_SECRET = '';   // le « Client Secret » de la même page
const DRIVE_FILE_ID        = '';   // l'ID de cockpit-data.json (ou colle le lien de partage entier)
const CODE_STRAVA          = '';   // à remplir à l'étape 2 (le code récupéré dans la barre d'adresse)
// =======================================================================

const FUSEAU = 'Europe/Paris';
const MAX_DETAILS_PAR_SYNCHRO = 25;   // limite les appels Strava (quota : 100 lectures / 15 min)
const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const RECORDS = { '1k': '1 km', '5k': '5 km', '10k': '10 km', '15k': '15 km', 'Half-Marathon': 'Semi-marathon', 'Marathon': 'Marathon' };
const ORDRE_RECORDS = ['1 km', '5 km', '10 km', '15 km', 'Semi-marathon', 'Marathon'];

// ---------------------------------------------------------------------
// ÉTAPES D'INSTALLATION (à lancer une fois chacune, dans l'ordre)
// ---------------------------------------------------------------------

/** Étape 1 : affiche le lien d'autorisation Strava à ouvrir dans ton navigateur. */
function etape1_lienStrava() {
  verifierConfig_(false);
  const url = 'https://www.strava.com/oauth/authorize'
    + '?client_id=' + encodeURIComponent(STRAVA_CLIENT_ID)
    + '&response_type=code&redirect_uri=http://localhost&approval_prompt=force'
    + '&scope=read,activity:read_all,profile:read_all';
  Logger.log('1) Ouvre ce lien, clique sur « Autoriser » :\n' + url);
  Logger.log('2) Tu arrives sur une page qui ne charge pas (c\'est normal). Dans la barre d\'adresse, copie ce qui suit « code= » et s\'arrête avant « &scope ».');
  Logger.log('3) Colle-le dans CODE_STRAVA en haut du script, enregistre, puis lance etape2_connecterStrava.');
}

/** Étape 2 : échange le code contre une connexion durable à Strava. */
function etape2_connecterStrava() {
  verifierConfig_(false);
  if (!CODE_STRAVA) throw new Error('Remplis d\'abord CODE_STRAVA (voir étape 1).');
  const r = UrlFetchApp.fetch('https://www.strava.com/oauth/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, code: CODE_STRAVA.trim(), grant_type: 'authorization_code' }
  });
  const j = JSON.parse(r.getContentText());
  if (r.getResponseCode() !== 200) throw new Error('Strava a refusé le code (il ne sert qu\'une fois, refais l\'étape 1) : ' + r.getContentText());
  if (j.athlete === undefined && !j.refresh_token) throw new Error('Réponse inattendue : ' + r.getContentText());
  enregistrerJetons_(j);
  Logger.log('✅ Connecté à Strava' + (j.athlete ? ' en tant que ' + j.athlete.firstname + ' ' + j.athlete.lastname : '') + '. Lance maintenant etape3_installer.');
}

/** Étape 3 : crée la clé secrète, la synchro toutes les 15 min, et fait une première synchro. */
function etape3_installer() {
  verifierConfig_(true);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CLE_SECRETE')) props.setProperty('CLE_SECRETE', Utilities.getUuid().replace(/-/g, ''));
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'synchroniser').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('synchroniser').timeBased().everyMinutes(15).create();
  const res = synchroniser();
  Logger.log('✅ Synchro auto toutes les 15 min installée. Première synchro : ' + JSON.stringify(res));
  Logger.log('🔑 Ta clé secrète (à coller dans les réglages de l\'appli) : ' + props.getProperty('CLE_SECRETE'));
  Logger.log('Dernière étape : Déployer → Nouveau déploiement → Application Web → Exécuter en tant que « Moi » → Accès « Tout le monde » → copie l\'URL.');
}

/** Optionnel : récupère tout ton historique Strava (sans le détail, pour ménager le quota). */
function importerHistorique() {
  const data = lireDonnees_();
  const token = jetonStrava_();
  const index = new Map(data.activities.map(a => [String(a.id), a]));
  let page = 1, ajout = 0;
  while (page < 30) {
    const lot = strava_('/athlete/activities?per_page=100&page=' + page, token);
    if (!lot.length) break;
    lot.forEach(a => { if (!index.has(String(a.id))) { index.set(String(a.id), versCockpit_(a, null)); ajout++; } });
    page++;
  }
  data.activities = trier_([...index.values()]);
  ecrireDonnees_(data);
  Logger.log('✅ Historique importé : ' + ajout + ' activités ajoutées (' + data.activities.length + ' au total).');
}

/**
 * À lancer une fois (et chaque fois que tu veux tout remettre d'aplomb) :
 *  - importe tout ton historique Strava (avec le cardio),
 *  - retire les activités supprimées sur Strava,
 *  - recalcule tous tes records à partir de tes sorties (par lots, pour respecter le quota Strava).
 */
function remiseANiveau() {
  const data = lireDonnees_();
  const token = jetonStrava_();
  const toutes = listerTout_(token);
  const ids = new Set(toutes.map(a => String(a.id)));
  const avant = data.activities.length;
  const index = new Map(data.activities.filter(a => ids.has(String(a.id))).map(a => [String(a.id), a]));
  const supprimees = avant - index.size;
  toutes.forEach(a => {
    const id = String(a.id), ancienne = index.get(id), fusion = Object.assign({}, ancienne || {}, versCockpit_(a, null));
    if (ancienne && ancienne.race) fusion.race = true;
    index.set(id, fusion);
  });
  data.activities = trier_([...index.values()]);
  lancerRecalculRecords_(data);
  traiterRecords_(data, token, 60);
  ecrireDonnees_(data);
  const reste = fileRecords_().length;
  Logger.log('✅ ' + data.activities.length + ' activités (' + supprimees + ' supprimées retirées). ' + data.activities.filter(a => a.hr).length + ' avec cardio.');
  Logger.log(reste ? '⏳ Records : encore ' + reste + ' sorties à analyser, la synchro auto s\'en charge (≈ ' + Math.ceil(reste / 20 / 4) + ' h).' : '🏅 Records recalculés : ' + JSON.stringify(data.records));
}

/** Ancien nom, conservé : fait la même chose que remiseANiveau. */
function recupererCardio() { remiseANiveau(); }

function listerTout_(token) {
  let page = 1, out = [];
  while (page <= 20) {
    const lot = strava_('/athlete/activities?per_page=200&page=' + page, token);
    out = out.concat(lot);
    if (lot.length < 200) break;
    page++;
  }
  return out;
}

// Records : on repart de zéro et on analyse le détail de chaque sortie course, par lots.
function fileRecords_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('RECORDS_A_FAIRE') || '[]'); } catch (e) { return []; } }
function lancerRecalculRecords_(data) {
  const runs = data.activities.filter(a => RUN_TYPES.indexOf(a.type) >= 0 && !(a.max_kmh > 30)).map(a => String(a.id));
  data.records = [];
  PropertiesService.getScriptProperties().setProperty('RECORDS_A_FAIRE', JSON.stringify(runs));
  data.records_pending = runs.length;
}
function traiterRecords_(data, token, max) {
  const file = fileRecords_();
  if (!file.length) { delete data.records_pending; return 0; }
  const index = new Map(data.activities.map(a => [String(a.id), a]));
  let n = 0;
  while (file.length && n < max) {
    const id = file[0];
    let d;
    try { d = strava_('/activities/' + id, token); } catch (e) { if (/Quota/.test(e.message)) break; file.shift(); continue; }
    file.shift(); n++;
    const a = index.get(id);
    if (a) Object.assign(a, versCockpit_(d, d), a.race ? { race: true } : {});
    majRecords_(data, d);
  }
  PropertiesService.getScriptProperties().setProperty('RECORDS_A_FAIRE', JSON.stringify(file));
  if (file.length) data.records_pending = file.length; else delete data.records_pending;
  return n;
}

// ---------------------------------------------------------------------
// MUSCU : détail des séries déposé sur le Drive par la tâche de nuit de Claude
// (l'API Strava ne permet pas de lire les séries : c'est Claude qui les récupère)
// Fichiers attendus : « cockpit-muscu*.json » n'importe où dans le Drive, au format
// { type: "cockpit-muscu", exercises: { "Bench Press": ["Chest","Triceps"] },
//   workouts: [ { id: "123", date: "2026-11-12", sets: [["Bench Press", 60, 8, 5]] } ] }
// sets = [exercice, charge kg (null = sans charge), répétitions, nombre de séries identiques]
// ---------------------------------------------------------------------
function integrerMuscu_(data) { return integrerFichiers_(data); }

// Intègre tous les fichiers « cockpit-*.json » déposés sur le Drive (sauf cockpit-data.json), puis les met à la corbeille.
//  - type "cockpit-muscu" : détail des séries (voir ci-dessus)
//  - type "cockpit-patch" : { activities: { "<id>": { champs à ajouter } }, data: { clé: valeur } }
//    sert à ajouter un plan de course, un profil, un objectif… sans modifier ce script.
function integrerFichiers_(data) {
  const it = DriveApp.searchFiles("title contains 'cockpit-' and trashed = false");
  const principal = idFichier_();
  let n = 0;
  while (it.hasNext()) {
    const f = it.next();
    if (f.getId() === principal || !/\.json$/i.test(f.getName())) continue;
    let j;
    try { j = JSON.parse(f.getBlob().getDataAsString('UTF-8')); } catch (e) { console.warn('Fichier illisible : ' + f.getName()); continue; }
    if (!j || typeof j !== 'object') continue;
    if (j.type === 'cockpit-muscu' && Array.isArray(j.workouts)) {
      data.exercises = Object.assign(data.exercises || {}, j.exercises || {});
      data.muscu = data.muscu || {};
      j.workouts.forEach(w => { if (w && w.id && Array.isArray(w.sets)) { data.muscu[String(w.id)] = { date: w.date || null, sets: w.sets }; n++; } });
    } else if (j.type === 'cockpit-patch') {
      data.patches_en_attente = data.patches_en_attente || {};
      Object.keys(j.activities || {}).forEach(id => { data.patches_en_attente[id] = Object.assign(data.patches_en_attente[id] || {}, j.activities[id]); n++; });
      Object.keys(j.data || {}).forEach(k => {
        const v = j.data[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) Object.assign(data[k], v); else data[k] = v;
        n++;
      });
    } else continue;
    f.setTrashed(true);
  }
  appliquerPatchs_(data);
  return n;
}

// Applique les champs en attente aux activités déjà présentes (les autres attendent leur synchro).
function appliquerPatchs_(data) {
  const P = data.patches_en_attente;
  if (!P) return 0;
  let n = 0;
  data.activities.forEach(a => { const p = P[String(a.id)]; if (p) { Object.assign(a, p); delete P[String(a.id)]; n++; } });
  if (!Object.keys(P).length) delete data.patches_en_attente;
  return n;
}

// Courses : récupère le profil d'altitude et les temps au km (tours de la montre) des courses qui ne les ont pas encore.
function detailsCourses_(data, token, max) {
  let n = 0;
  for (const a of data.activities) {
    if (n >= max) break;
    if (!a.race || a.profil_fait || RUN_TYPES.indexOf(a.type) < 0) continue;
    try {
      if (!a.tours) {
        const d = strava_('/activities/' + a.id, token);
        const laps = (d.laps && d.laps.length > 1) ? d.laps : null;
        if (laps) a.tours = laps.map(l => [Math.round(l.distance), l.elapsed_time, Math.round(l.total_elevation_gain || 0), l.average_heartrate ? Math.round(l.average_heartrate) : null]);
        else if (d.splits_metric && d.splits_metric.length) a.tours = d.splits_metric.map(sp => [Math.round(sp.distance), sp.elapsed_time, Math.max(0, Math.round(sp.elevation_difference || 0)), sp.average_heartrate ? Math.round(sp.average_heartrate) : null]);
      }
      if (!a.profil) {
        const st = strava_('/activities/' + a.id + '/streams?keys=distance,altitude&key_by_type=true', token);
        const dist = st.distance && st.distance.data, alt = st.altitude && st.altitude.data;
        if (dist && alt && dist.length === alt.length && dist.length > 10) {
          const step = Math.max(1, Math.floor(dist.length / 120)), pr = [];
          for (let i = 0; i < dist.length; i += step) pr.push([Math.round(dist[i]), Math.round(alt[i] * 10) / 10]);
          pr.push([Math.round(dist[dist.length - 1]), Math.round(alt[alt.length - 1] * 10) / 10]);
          a.profil = pr;
        }
      }
      a.profil_fait = true;
      n++;
    } catch (e) { if (/Quota/.test(e.message)) break; console.warn(e); }
  }
  return n;
}

/** Optionnel : lance l'intégration des fichiers muscu tout de suite (sinon c'est fait à chaque synchro). */
function integrerMuscu() {
  const data = lireDonnees_();
  const n = integrerMuscu_(data);
  if (n) ecrireDonnees_(data);
  Logger.log(n ? '✅ ' + n + ' éléments intégrés (' + Object.keys(data.muscu || {}).length + ' séances de muscu au total).' : 'Aucun fichier cockpit-… à intégrer.');
}

// Une fois par jour : retire les activités supprimées sur Strava (et relance les records si l'une d'elles en détenait un).
function nettoyageQuotidien_(data, token) {
  const props = PropertiesService.getScriptProperties();
  const jour = Utilities.formatDate(new Date(), FUSEAU, 'yyyy-MM-dd');
  if (props.getProperty('DERNIER_NETTOYAGE') === jour) return false;
  const ids = new Set(listerTout_(token).map(a => String(a.id)));
  props.setProperty('DERNIER_NETTOYAGE', jour);
  const retirees = data.activities.filter(a => !ids.has(String(a.id))).map(a => String(a.id));
  if (!retirees.length) return false;
  data.activities = data.activities.filter(a => ids.has(String(a.id)));
  if (data.muscu) retirees.forEach(id => delete data.muscu[id]);
  if ((data.records || []).some(r => retirees.indexOf(String(r.activity_id)) >= 0)) lancerRecalculRecords_(data);
  return true;
}

/** Optionnel : affiche la clé secrète si tu l'as perdue. */
function afficherCle() { Logger.log(PropertiesService.getScriptProperties().getProperty('CLE_SECRETE')); }

// ---------------------------------------------------------------------
// SYNCHRO
// ---------------------------------------------------------------------

/** Récupère les activités récentes et met à jour le fichier si quelque chose a changé. */
function synchroniser(options) {
  const depuisAppli = !!(options && options.depuisAppli === true);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { statut: 'déjà en cours' };
  try {
    const data = lireDonnees_();
    const token = jetonStrava_();
    const index = new Map(data.activities.map(a => [String(a.id), a]));

    // Fenêtre : depuis la plus récente activité connue, moins 3 jours (pour rattraper les modifs)
    const derniere = data.activities.reduce((m, a) => Math.max(m, Date.parse(a.start + 'Z') || 0), 0);
    const after = derniere ? Math.floor(derniere / 1000) - 3 * 86400 : Math.floor(Date.now() / 1000) - 60 * 86400;

    let page = 1, recues = [];
    while (page <= 5) {
      const lot = strava_('/athlete/activities?per_page=100&page=' + page + '&after=' + after, token);
      recues = recues.concat(lot);
      if (lot.length < 100) break;
      page++;
    }

    let nouvelles = 0, modifiees = 0, details = 0;
    recues.forEach(a => {
      const id = String(a.id), ancienne = index.get(id);
      const besoinDetail = (!ancienne || ancienne.name !== a.name) && details < MAX_DETAILS_PAR_SYNCHRO;
      let d = null;
      if (besoinDetail) { try { d = strava_('/activities/' + id, token); details++; } catch (e) { console.warn(e); } }
      const maj = versCockpit_(a, d);
      // On garde ce que tu as ajouté à la main (objectif, météo, course…)
      const fusion = Object.assign({}, ancienne || {}, maj);
      if (ancienne && ancienne.race) fusion.race = true;
      if (!ancienne) nouvelles++;
      else if (JSON.stringify(ancienne) !== JSON.stringify(fusion)) modifiees++;
      index.set(id, fusion);
      if (d) majRecords_(data, d);
    });

    data.activities = trier_([...index.values()]);
    let menage = false, analysees = 0, muscu = 0;
    try { muscu = integrerFichiers_(data) + appliquerPatchs_(data); } catch (e) { console.warn(e); }
    let courses = 0;
    if (!depuisAppli) { try { courses = detailsCourses_(data, token, 2); } catch (e) { console.warn(e); } }
    try { menage = nettoyageQuotidien_(data, token); } catch (e) { console.warn(e); }
    if (!depuisAppli) { try { analysees = traiterRecords_(data, token, 20); } catch (e) { console.warn(e); } }
    if (nouvelles || modifiees || menage || analysees || muscu || courses) ecrireDonnees_(data);
    return { statut: 'ok', recues: recues.length, nouvelles: nouvelles, modifiees: modifiees, records_en_attente: fileRecords_().length, muscu_integrees: muscu };
  } finally {
    lock.releaseLock();
  }
}

/** Point d'accès de l'appli : ?key=CLE&sync=1 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const cle = PropertiesService.getScriptProperties().getProperty('CLE_SECRETE');
  if (!cle || p.key !== cle) return json_({ error: 'Clé incorrecte.' });
  let info = null;
  if (p.sync === '1') { try { info = synchroniser({ depuisAppli: true }); } catch (err) { info = { statut: 'erreur', message: String(err.message || err) }; } }
  const data = lireDonnees_();
  data.sync = info;
  return json_(data);
}

// ---------------------------------------------------------------------
// OUTILS
// ---------------------------------------------------------------------

function versCockpit_(a, d) {
  const type = a.sport_type || a.type;
  const course = RUN_TYPES.indexOf(type) >= 0;
  const o = {
    id: String(a.id),
    name: a.name,
    type: type,
    start: String(a.start_date_local || '').replace('Z', ''),
    km: Math.round((a.distance || 0)) / 1000,
    sec: a.moving_time,
    elapsed: a.elapsed_time,
    dplus: Math.round(a.total_elevation_gain || 0),
    cad: a.average_cadence ? Math.round(a.average_cadence * 10) / 10 : undefined,
    hr: a.average_heartrate ? Math.round(a.average_heartrate) : undefined,
    hr_max: a.max_heartrate ? Math.round(a.max_heartrate) : undefined,
    re: a.suffer_score != null ? Math.round(a.suffer_score) : undefined,
    max_kmh: a.max_speed ? Math.round(a.max_speed * 36) / 10 : undefined,
    race: course && a.workout_type === 1 ? true : undefined,
    gear: a.gear_id || undefined
  };
  if (d) {
    if (d.calories) o.kcal = Math.round(d.calories);
    if (d.description) o.desc = d.description;
  }
  Object.keys(o).forEach(k => o[k] === undefined && delete o[k]);
  return o;
}

function majRecords_(data, d) {
  if (!d.best_efforts || !d.best_efforts.length) return;
  if (d.max_speed && d.max_speed * 3.6 > 30) return; // vitesse anormale : on ne compte pas
  data.records = data.records || [];
  d.best_efforts.forEach(be => {
    const label = RECORDS[be.name];
    if (!label) return;
    const rec = data.records.find(r => r.label === label);
    const source = rec && data.activities.find(a => String(a.id) === String(rec.activity_id));
    const recSuspect = source && source.max_kmh > 30; // ancien record faussé par le GPS : on le remplace
    if (!rec || recSuspect || be.elapsed_time < rec.sec) {
      const nouveau = { label: label, sec: be.elapsed_time, date: String(d.start_date_local).slice(0, 10), activity_id: String(d.id) };
      if (rec) Object.assign(rec, nouveau); else data.records.push(nouveau);
    }
  });
  data.records.sort((x, y) => ORDRE_RECORDS.indexOf(x.label) - ORDRE_RECORDS.indexOf(y.label));
}

function trier_(arr) { return arr.sort((a, b) => String(b.start).localeCompare(String(a.start))); }

function idFichier_() { const m = String(DRIVE_FILE_ID).match(/[-\w]{25,}/); return m ? m[0] : DRIVE_FILE_ID; }

function lireDonnees_() {
  const txt = DriveApp.getFileById(idFichier_()).getBlob().getDataAsString('UTF-8');
  const data = txt.trim() ? JSON.parse(txt) : {};
  data.version = data.version || 1;
  data.activities = data.activities || [];
  data.records = data.records || [];
  if (!('next_race' in data)) data.next_race = null;
  delete data.sync;
  return data;
}

function ecrireDonnees_(data) {
  data.generated_at = Utilities.formatDate(new Date(), FUSEAU, "yyyy-MM-dd'T'HH:mm:ss");
  DriveApp.getFileById(idFichier_()).setContent(JSON.stringify(data, null, 1));
}

function enregistrerJetons_(j) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('STRAVA_REFRESH', j.refresh_token);
  props.setProperty('STRAVA_ACCESS', j.access_token);
  props.setProperty('STRAVA_EXPIRE', String(j.expires_at));
}

function jetonStrava_() {
  const props = PropertiesService.getScriptProperties();
  const exp = Number(props.getProperty('STRAVA_EXPIRE') || 0);
  if (props.getProperty('STRAVA_ACCESS') && exp - 300 > Date.now() / 1000) return props.getProperty('STRAVA_ACCESS');
  const refresh = props.getProperty('STRAVA_REFRESH');
  if (!refresh) throw new Error('Pas encore connecté à Strava : lance etape1 puis etape2.');
  const r = UrlFetchApp.fetch('https://www.strava.com/oauth/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refresh }
  });
  if (r.getResponseCode() !== 200) throw new Error('Renouvellement Strava refusé : ' + r.getContentText());
  const j = JSON.parse(r.getContentText());
  enregistrerJetons_(j);
  return j.access_token;
}

function strava_(chemin, token) {
  const r = UrlFetchApp.fetch('https://www.strava.com/api/v3' + chemin, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  const code = r.getResponseCode();
  if (code === 429) throw new Error('Quota Strava atteint, nouvel essai à la prochaine synchro.');
  if (code !== 200) throw new Error('Strava ' + code + ' sur ' + chemin + ' : ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function verifierConfig_(avecDrive) {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) throw new Error('Remplis STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET en haut du script.');
  if (avecDrive) {
    if (!DRIVE_FILE_ID) throw new Error('Remplis DRIVE_FILE_ID en haut du script.');
    DriveApp.getFileById(idFichier_()); // vérifie l'accès au fichier
  }
}
