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

/** À lancer une fois : ajoute le cardio (FC moyenne/max) et l'effort aux activités des 4 derniers mois déjà importées. */
function recupererCardio() {
  const data = lireDonnees_();
  const token = jetonStrava_();
  const index = new Map(data.activities.map(a => [String(a.id), a]));
  const after = Math.floor(Date.now() / 1000) - 120 * 86400;
  let page = 1, maj = 0;
  while (page <= 5) {
    const lot = strava_('/athlete/activities?per_page=100&page=' + page + '&after=' + after, token);
    lot.forEach(a => {
      const id = String(a.id), ancienne = index.get(id), m = versCockpit_(a, null);
      const fusion = Object.assign({}, ancienne || {}, m);
      if (ancienne && ancienne.race) fusion.race = true;
      if (!ancienne || JSON.stringify(ancienne) !== JSON.stringify(fusion)) maj++;
      index.set(id, fusion);
    });
    if (lot.length < 100) break;
    page++;
  }
  data.activities = trier_([...index.values()]);
  ecrireDonnees_(data);
  const avecFc = data.activities.filter(a => a.hr).length;
  Logger.log('✅ ' + maj + ' activités mises à jour. ' + avecFc + ' activités ont maintenant le cardio.');
}

/** Optionnel : affiche la clé secrète si tu l'as perdue. */
function afficherCle() { Logger.log(PropertiesService.getScriptProperties().getProperty('CLE_SECRETE')); }

// ---------------------------------------------------------------------
// SYNCHRO
// ---------------------------------------------------------------------

/** Récupère les activités récentes et met à jour le fichier si quelque chose a changé. */
function synchroniser() {
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
    if (nouvelles || modifiees) ecrireDonnees_(data);
    return { statut: 'ok', recues: recues.length, nouvelles: nouvelles, modifiees: modifiees };
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
  if (p.sync === '1') { try { info = synchroniser(); } catch (err) { info = { statut: 'erreur', message: String(err.message || err) }; } }
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
