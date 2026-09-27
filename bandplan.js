/* bandplan.js */
/* ═══════════════════════════════════════════════════════════════════════
   BandPlan — Premium Music Group Operating System
   Architecture: 3-file Vanilla JS PWA (index.html + bandplan.css + bandplan.js)
   Storage: IndexedDB (offline-first) + sync queue · Design: Claymorphism
   Navigation: 4 tabs — Календарь · Песни · Сет-листы и группы · Ещё
   Features: recurring events, reminders + notifications, participation status,
             songs (chords, transpose, versions, attachments, multi-select),
             print & PDF (preview, options, page breaks), setlists (drag & drop,
             key/bpm override, lead, transitions, statuses), groups (roles,
             custom roles, archive, logo), members (contacts, statuses),
             scene mode (autoscroll, wake lock, fullscreen), import/export,
             command palette, global search, PWA install, themes + accent.
   Performance: event delegation, memoized indexes, chunked rendering,
             rAF-throttled updates, debounced search, passive listeners.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ═══ SECTION 1: UTILITIES & HELPERS ═══ */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const uid = p => (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pad2 = n => String(n).padStart(2, '0');
const toDate = d => (d instanceof Date ? d : new Date(d));
function debounce(fn, ms) { let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms || 250); }; }
function throttleRAF(fn) { let q = false, la = null; return function () { la = arguments; if (q) return; q = true; requestAnimationFrame(() => { q = false; fn.apply(this, la); }); }; }
function escapeHtml(v) { if (v == null) return ''; return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function startOfDay(d) { const x = toDate(d); x.setHours(0, 0, 0, 0); return x; }
function formatDate(d) {
  if (!d) return ''; const x = toDate(d); if (isNaN(x)) return '';
  const f = State.settings.dateFormat;
  if (f === 'numeric') return pad2(x.getDate()) + '.' + pad2(x.getMonth() + 1) + '.' + x.getFullYear();
  if (f === 'short') return x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' });
  return x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
function formatDateShort(d) { if (!d) return ''; const x = toDate(d); return x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); }
function formatTime(d) {
  if (!d) return ''; const x = toDate(d); if (isNaN(x)) return '';
  const h = x.getHours(), m = pad2(x.getMinutes());
  if (State.settings.timeFormat === '12') { const ap = h < 12 ? 'AM' : 'PM'; return (((h + 11) % 12) + 1) + ':' + m + ' ' + ap; }
  return pad2(h) + ':' + m;
}
function toLocalDateInput(d) { const x = toDate(d); return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate()); }
function toLocalTimeInput(d) { const x = toDate(d); return pad2(x.getHours()) + ':' + pad2(x.getMinutes()); }
function dateKey(d) { return toLocalDateInput(d); }
function minutesToTime(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
function durationLabel(sec) { if (!sec) return '—'; return Math.floor(sec / 60) + ':' + pad2(sec % 60); }
function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return one; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few; return many; }
function bytesLabel(b) { if (!b) return '0 КБ'; if (b < 1024) return b + ' Б'; if (b < 1048576) return (b / 1024).toFixed(0) + ' КБ'; return (b / 1048576).toFixed(1) + ' МБ'; }
function combineDateTime(dateStr, timeStr) { const p = String(dateStr).split('-').map(Number); const t = String(timeStr || '00:00').split(':').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1, t[0] || 0, t[1] || 0, 0, 0); }
function downloadFile(name, text, type) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (e) { Logger.error('download', e); return false; }
}
function safeFile(n) { return String(n || 'bandplan').replace(/[^\w\d\-А-Яа-яЁё ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'bandplan'; }
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const f = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
  const n = parseInt(f, 16);
  return isNaN(n) ? { r: 99, g: 102, b: 241 } : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function hexToRgba(hex, a) { const c = hexToRgb(hex); return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'; }
function shadeColor(hex, amt) {
  const c = hexToRgb(hex);
  const f = v => clamp(Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt), 0, 255);
  return '#' + [f(c.r), f(c.g), f(c.b)].map(v => pad2(v.toString(16))).join('');
}
const ICONS = {
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.2l3.4 2"/>',
  pin: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  users: '<path d="M15.6 20.4v-1.8a3.6 3.6 0 0 0-3.6-3.6H6.6a3.6 3.6 0 0 0-3.6 3.6v1.8"/><circle cx="9.3" cy="7.5" r="3.6"/><path d="M21 20.4v-1.8a3.6 3.6 0 0 0-2.7-3.5"/>',
  music: '<path d="M9 18V5.4l11-1.8V16"/><circle cx="6.2" cy="18" r="2.8"/><circle cx="17.2" cy="16" r="2.8"/>',
  calendar: '<rect x="3.2" y="5" width="17.6" height="15.8" rx="3"/><path d="M3.2 10h17.6M8.2 3.2v3.6M15.8 3.2v3.6"/>',
  stage: '<rect x="2.6" y="4.2" width="18.8" height="12.6" rx="3"/><path d="M8.4 20.6h7.2M12 16.8v3.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>', up: '<path d="m6 15 6-6 6 6"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13"/>', edit: '<path d="M4 20h4L20 8l-4-4L4 16v4z"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9"/>',
  print: '<path d="M7 9V3.8h10V9"/><rect x="3.5" y="9" width="17" height="7.5" rx="2"/><path d="M7 14h10v6.2H7z"/>',
  download: '<path d="M12 3.5v11M7.5 10 12 14.5 16.5 10M4.5 19.5h15"/>',
  upload: '<path d="M12 20V9M7.5 13.5 12 9l4.5 4.5M4.5 4.5h15"/>',
  bell: '<path d="M6.4 10a5.6 5.6 0 1 1 11.2 0c0 4.4 1.8 5.8 1.8 5.8H4.6s1.8-1.4 1.8-5.8z"/><path d="M10.2 19a2 2 0 0 0 3.6 0"/>',
  refresh: '<path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.6"/><path d="M4 4.6v4h4"/><path d="M4 12.5a8 8 0 0 0 13.7 5.2L20 15.4"/><path d="M20 19.4v-4h-4"/>',
  filter: '<path d="M3.5 5.5h17l-6.6 7.6v5.6l-3.8 2v-7.6z"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  list: '<path d="M8.4 6.4h12M8.4 12h12M8.4 17.6h12"/><path d="M3.8 6.4h.01M3.8 12h.01M3.8 17.6h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.2 20.2-3.7-3.7"/>',
  check: '<path d="m4.8 12.4 4.8 4.8 9.6-9.6"/>',
  paperclip: '<path d="M20 11.5 12.4 19a4.6 4.6 0 0 1-6.5-6.5l7.6-7.6a3.1 3.1 0 0 1 4.4 4.4l-7.5 7.6a1.6 1.6 0 0 1-2.2-2.2l6.9-6.9"/>',
  link: '<path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1.5"/><path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18.5v-10M10 12.5h4"/>',
  repeat: '<path d="M17 2.5 21 6l-4 3.5"/><path d="M21 6H7.5A3.5 3.5 0 0 0 4 9.5V11"/><path d="M7 21.5 3 18l4-3.5"/><path d="M3 18h13.5a3.5 3.5 0 0 0 3.5-3.5V13"/>'
};
function icon(n, s) { return '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>'; }
const Logger = {
  enabled: false,
  log() { if (this.enabled && window.console) console.log.apply(console, ['[BandPlan]'].concat([].slice.call(arguments))); },
  warn() { if (window.console && window.console.warn) console.warn.apply(console, ['[BandPlan]'].concat([].slice.call(arguments))); },
  error() { if (window.console && window.console.error) console.error.apply(console, ['[BandPlan]'].concat([].slice.call(arguments))); }
};

/* ═══ SECTION 3: STORAGE (IndexedDB) ═══ */
const DB_NAME = 'bandplan_db', DB_VERSION = 3;
const STORES = ['songs', 'events', 'setlists', 'groups', 'members', 'songVersions', 'reminders', 'activity', 'meta', 'syncQueue', 'files', 'fileMeta'];
let _db = null; const _mem = {}; let storageMode = 'indexeddb';
function openDB() {
  return new Promise(resolve => {
    if (!('indexedDB' in window) || !window.indexedDB) { storageMode = 'memory'; return resolve(null); }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { storageMode = 'memory'; return resolve(null); }
    req.onupgradeneeded = ev => { const db = ev.target.result; STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); }); };
    req.onsuccess = ev => { _db = ev.target.result; _db.onversionchange = () => { try { _db.close(); } catch (e) {} _db = null; }; resolve(_db); };
    req.onerror = () => { storageMode = 'memory'; resolve(null); };
    req.onblocked = () => { storageMode = 'memory'; resolve(null); };
  });
}
function dbGetAll(store) {
  return new Promise(res => {
    if (!_db) return res((_mem[store] || []).slice());
    try { const rq = _db.transaction(store, 'readonly').objectStore(store).getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); }
    catch (e) { res([]); }
  });
}
function dbGet(store, id) {
  return new Promise(res => {
    if (!_db) return res((_mem[store] || []).find(x => x.id === id) || null);
    try { const rq = _db.transaction(store, 'readonly').objectStore(store).get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }
    catch (e) { res(null); }
  });
}
function dbPut(store, obj) {
  return new Promise(res => {
    if (!_db) { _mem[store] = _mem[store] || []; const i = _mem[store].findIndex(x => x.id === obj.id); if (i >= 0) _mem[store][i] = obj; else _mem[store].push(obj); return res(); }
    try { const tx = _db.transaction(store, 'readwrite'); tx.objectStore(store).put(obj); tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res(); }
    catch (e) { res(); }
  });
}
function dbDelete(store, id) {
  return new Promise(res => {
    if (!_db) { _mem[store] = (_mem[store] || []).filter(x => x.id !== id); return res(); }
    try { const tx = _db.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res(); }
    catch (e) { res(); }
  });
}
function dbClear(store) {
  return new Promise(res => {
    if (!_db) { _mem[store] = []; return res(); }
    try { const tx = _db.transaction(store, 'readwrite'); tx.objectStore(store).clear(); tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res(); }
    catch (e) { res(); }
  });
}
const PREFS_KEY = 'bandplan.prefs.v1', DRAFT_SONG = 'bandplan.draft.song.v1', DRAFT_EVENT = 'bandplan.draft.event.v1';
function readPrefs() { try { const r = localStorage.getItem(PREFS_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; } }
function writePrefs(patch) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(Object.assign({}, readPrefs(), patch))); } catch (e) {} }
function readDraft(k) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function writeDraft(k, v) { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch (e) {} }

/* ═══ SECTION 2: STATE ═══ */
const DEFAULT_SETTINGS = {
  theme: 'light', systemTheme: false, accent: '#6366f1',
  dateFormat: 'long', timeFormat: '24', weekStart: 1, defaultView: 'month',
  lyricsFont: 15, chordFormat: 'auto', sceneFontSize: 24, autoscrollSpeed: 1,
  notifications: true, reminderDefaults: [60, 1440], reducedMotion: false,
  print: { font: 12, chords: true, notes: true, key: true, numbering: true, pageBreak: true },
  customRoles: [], onboardingDone: false, installDismissed: false, deviceId: null, lastBackup: null
};
const DEFAULT_PROFILE = { name: '', role: '', defaultParticipation: 'yes' };
const State = {
  songs: [], events: [], setlists: [], groups: [], members: [], songVersions: [], reminders: [],
  activity: [], syncQueue: [], fileMeta: [],
  settings: Object.assign({}, DEFAULT_SETTINGS), profile: Object.assign({}, DEFAULT_PROFILE),
  ui: {
    route: '/calendar', parts: [], base: '/calendar', tab: 'calendar',
    calendarDate: new Date(), calendarView: 'month', selectedDate: null,
    filters: { groupId: '', types: [], query: '', onlyMine: false, showArchived: false },
    songs: { filter: 'all', sort: 'updated', query: '', group: '', genre: '', key: '', language: '', tag: '', favOnly: false },
    selection: new Set(), selectMode: false,
    bandTab: 'setlists', bandQuery: '',
    transpose: 0, dragging: false, _gPrefix: false,
    scene: { setlistId: null, singleSongId: null, index: 0, font: 24, auto: false, speed: 1, transpose: 0, raf: null, wake: null }
  },
  ready: false, listeners: [],
  subscribe(fn) { this.listeners.push(fn); },
  notify() { for (let i = 0; i < this.listeners.length; i++) { try { this.listeners[i](this); } catch (e) { Logger.error(e); } } }
};
async function loadState() {
  await openDB();
  const r = await Promise.all([dbGetAll('songs'), dbGetAll('events'), dbGetAll('setlists'), dbGetAll('groups'), dbGetAll('members'), dbGetAll('songVersions'), dbGetAll('reminders'), dbGetAll('activity'), dbGetAll('meta'), dbGetAll('syncQueue'), dbGetAll('fileMeta')]);
  State.songs = r[0].map(migrateSong);
  State.events = r[1].map(migrateEvent);
  State.setlists = r[2].map(migrateSetlist);
  State.groups = r[3].map(migrateGroup);
  State.members = r[4].map(migrateMember);
  State.songVersions = r[5]; State.reminders = r[6]; State.activity = r[7]; State.syncQueue = r[9]; State.fileMeta = r[10];
  Object.assign(State.settings, DEFAULT_SETTINGS, readPrefs());
  Object.assign(State.settings.print, DEFAULT_SETTINGS.print, (readPrefs().print || {}));
  const meta = r[8];
  const themeMeta = meta.find(m => m.id === 'theme'); if (themeMeta && themeMeta.value) State.settings.theme = themeMeta.value;
  const profMeta = meta.find(m => m.id === 'profile'); if (profMeta && profMeta.value) Object.assign(State.profile, profMeta.value);
  const devMeta = meta.find(m => m.id === 'deviceId');
  if (devMeta && devMeta.value) State.settings.deviceId = devMeta.value;
  else { State.settings.deviceId = uid('dev'); dbPut('meta', { id: 'deviceId', value: State.settings.deviceId }); }
  applyTheme(State.settings.theme, true);
  applyAccent(State.settings.accent, true);
  applyTypography();
  State.ui.calendarView = State.settings.defaultView || 'month';
  State.ui.scene.font = State.settings.sceneFontSize || 24;
  State.ui.scene.speed = State.settings.autoscrollSpeed || 1;
  rebuildIndex();
}
/* — Migration layer (v1 → v3) — */
function migrateSong(s) {
  s.tags = Array.isArray(s.tags) ? s.tags : [];
  s.groupIds = Array.isArray(s.groupIds) ? s.groupIds : [];
  s.fileIds = Array.isArray(s.fileIds) ? s.fileIds : [];
  s.version = s.version || 1; s.favorite = !!s.favorite;
  if (typeof s.lyrics !== 'string') s.lyrics = s.lyrics || '';
  if (s.artist === undefined) s.artist = '';
  if (s.genre === undefined) s.genre = '';
  if (s.language === undefined) s.language = '';
  if (s.timeSignature === undefined) s.timeSignature = '';
  if (s.link === undefined) s.link = '';
  return s;
}
function migrateEvent(e) {
  if (!e.participants && Array.isArray(e.participantIds)) e.participants = e.participantIds.map(id => ({ memberId: id, status: 'confirmed', notes: '' }));
  e.participants = e.participants || [];
  e.participantIds = e.participantIds || e.participants.map(p => p.memberId);
  e.reminderOffsets = Array.isArray(e.reminderOffsets) ? e.reminderOffsets : [];
  e.status = e.status || 'confirmed';
  e.repeat = e.repeat || 'none';
  e.exdates = Array.isArray(e.exdates) ? e.exdates : [];
  e.fileIds = Array.isArray(e.fileIds) ? e.fileIds : [];
  if (e.myStatus === undefined) e.myStatus = null;
  if (!e.type) e.type = 'rehearsal';
  return e;
}
function migrateSetlist(sl) {
  sl.status = sl.status || 'active';
  sl.items = (sl.items || []).map((it, i) => ({
    id: it.id || uid('si'), songId: it.songId, position: i,
    keyOverride: it.keyOverride || null, bpmOverride: it.bpmOverride || null,
    notes: it.notes || '', transition: it.transition || '', leadMemberId: it.leadMemberId || null
  }));
  return sl;
}
function migrateGroup(g) { g.status = g.status || 'active'; g.notes = g.notes || ''; g.logoFileId = g.logoFileId || null; return g; }
function migrateMember(m) {
  m.roles = Array.isArray(m.roles) ? m.roles : [];
  m.groupIds = Array.isArray(m.groupIds) ? m.groupIds : [];
  m.status = m.status || 'active';
  m.contacts = m.contacts || { phone: '', email: '', telegram: '', whatsapp: '' };
  return m;
}
/* — Indexes (perf) — */
const Index = { eventsByDay: new Map(), groupsById: new Map(), membersById: new Map(), songsById: new Map() };
function rebuildIndex() {
  Index.eventsByDay = new Map(); Index.groupsById = new Map(); Index.membersById = new Map(); Index.songsById = new Map();
  State.groups.forEach(g => Index.groupsById.set(g.id, g));
  State.members.forEach(m => Index.membersById.set(m.id, m));
  State.songs.forEach(s => Index.songsById.set(s.id, s));
  State.events.forEach(e => { const k = dateKey(e.start); let a = Index.eventsByDay.get(k); if (!a) { a = []; Index.eventsByDay.set(k, a); } a.push(e); });
  Index.eventsByDay.forEach(a => a.sort((x, y) => new Date(x.start) - new Date(y.start)));
  _expCache.sig = null;
}
function findSong(id) { return Index.songsById.get(id); }
function findEvent(id) { return State.events.find(e => e.id === id); }
function findSetlist(id) { return State.setlists.find(s => s.id === id); }
function findGroup(id) { return Index.groupsById.get(id); }
function findMember(id) { return Index.membersById.get(id); }
function groupName(id) { const g = findGroup(id); return g ? g.name : ''; }
function groupColor(id) { const g = findGroup(id); return (g && g.color) || State.settings.accent; }
function queueChange(entity, op, id) {
  const it = { id: uid('sq'), entity, op, refId: id, deviceId: State.settings.deviceId, ts: nowISO(), synced: false };
  State.syncQueue.push(it); dbPut('syncQueue', it);
  if (State.syncQueue.length > 600) { const d = State.syncQueue.shift(); dbDelete('syncQueue', d.id); }
  updateNavCounts();
}
async function logActivity(type, text, refId) {
  const it = { id: uid('act'), type, text, refId: refId || null, ts: nowISO() };
  State.activity.unshift(it);
  if (State.activity.length > 60) State.activity.length = 60;
  await dbPut('activity', it);
}
/* — CRUD — */
async function saveSong(s) { s.updatedAt = nowISO(); if (!s.createdAt) s.createdAt = s.updatedAt; await dbPut('songs', s); const i = State.songs.findIndex(x => x.id === s.id); if (i >= 0) State.songs[i] = s; else State.songs.push(s); rebuildIndex(); queueChange('songs', 'upsert', s.id); State.notify(); return s; }
async function saveEvent(e) {
  e.updatedAt = nowISO(); if (!e.createdAt) e.createdAt = e.updatedAt;
  e.participants = e.participants || []; e.participantIds = e.participants.map(p => p.memberId);
  await dbPut('events', e);
  const i = State.events.findIndex(x => x.id === e.id); if (i >= 0) State.events[i] = e; else State.events.push(e);
  rebuildIndex(); await syncReminders(e); queueChange('events', 'upsert', e.id); State.notify(); return e;
}
async function saveSetlist(sl) { sl.updatedAt = nowISO(); if (!sl.createdAt) sl.createdAt = sl.updatedAt; (sl.items || []).forEach((it, i) => { it.position = i; }); await dbPut('setlists', sl); const i = State.setlists.findIndex(x => x.id === sl.id); if (i >= 0) State.setlists[i] = sl; else State.setlists.push(sl); queueChange('setlists', 'upsert', sl.id); State.notify(); return sl; }
async function saveGroup(g) { g.updatedAt = nowISO(); if (!g.createdAt) g.createdAt = g.updatedAt; await dbPut('groups', g); const i = State.groups.findIndex(x => x.id === g.id); if (i >= 0) State.groups[i] = g; else State.groups.push(g); rebuildIndex(); queueChange('groups', 'upsert', g.id); State.notify(); return g; }
async function saveMember(m) { m.updatedAt = nowISO(); if (!m.createdAt) m.createdAt = m.updatedAt; await dbPut('members', m); const i = State.members.findIndex(x => x.id === m.id); if (i >= 0) State.members[i] = m; else State.members.push(m); rebuildIndex(); queueChange('members', 'upsert', m.id); State.notify(); return m; }
async function deleteSong(id) {
  const s = findSong(id);
  await dbDelete('songs', id);
  State.songs = State.songs.filter(x => x.id !== id);
  for (const sl of State.setlists) if ((sl.items || []).some(i => i.songId === id)) { sl.items = sl.items.filter(i => i.songId !== id); await dbPut('setlists', sl); }
  for (const g of State.groups) if ((g.songIds || []).indexOf(id) >= 0) { g.songIds = g.songIds.filter(x => x !== id); await dbPut('groups', g); }
  if (s) for (const f of (s.fileIds || [])) await deleteFile(f);
  rebuildIndex(); queueChange('songs', 'delete', id); State.notify();
}
async function deleteEvent(id) {
  const e = findEvent(id);
  await dbDelete('events', id);
  State.events = State.events.filter(x => x.id !== id);
  if (e) {
    State.events.filter(x => x.exceptionOf === id).forEach(async x => { await dbDelete('events', x.id); });
    State.events = State.events.filter(x => x.exceptionOf !== id);
  }
  for (const r of State.reminders.filter(r => r.eventId === id)) await dbDelete('reminders', r.id);
  State.reminders = State.reminders.filter(r => r.eventId !== id);
  rebuildIndex(); queueChange('events', 'delete', id); State.notify();
}
async function deleteSetlist(id) {
  await dbDelete('setlists', id);
  State.setlists = State.setlists.filter(x => x.id !== id);
  for (const e of State.events) if (e.setlistId === id) { e.setlistId = null; await dbPut('events', e); }
  rebuildIndex(); queueChange('setlists', 'delete', id); State.notify();
}
async function deleteGroup(id) {
  await dbDelete('groups', id);
  State.groups = State.groups.filter(x => x.id !== id);
  for (const m of State.members) { m.groupIds = (m.groupIds || []).filter(g => g !== id); await dbPut('members', m); }
  for (const s of State.songs) { s.groupIds = (s.groupIds || []).filter(g => g !== id); await dbPut('songs', s); }
  rebuildIndex(); queueChange('groups', 'delete', id); State.notify();
}
async function deleteMember(id) {
  await dbDelete('members', id);
  State.members = State.members.filter(x => x.id !== id);
  for (const e of State.events) { e.participants = (e.participants || []).filter(p => p.memberId !== id); await dbPut('events', e); }
  rebuildIndex(); queueChange('members', 'delete', id); State.notify();
}
/* — Files (attachments) — */
async function saveFile(file, kind, ownerId) {
  const id = uid('file');
  await dbPut('files', { id, blob: file });
  const meta = { id, name: file.name, type: file.type || '', size: file.size, kind: kind || 'song', ownerId: ownerId || null, createdAt: nowISO() };
  await dbPut('fileMeta', meta);
  State.fileMeta.push(meta);
  queueChange('files', 'upsert', id);
  return meta;
}
async function deleteFile(id) {
  await dbDelete('files', id); await dbDelete('fileMeta', id);
  State.fileMeta = State.fileMeta.filter(f => f.id !== id);
  for (const s of State.songs) if ((s.fileIds || []).indexOf(id) >= 0) { s.fileIds = s.fileIds.filter(f => f !== id); await dbPut('songs', s); }
  for (const e of State.events) if ((e.fileIds || []).indexOf(id) >= 0) { e.fileIds = e.fileIds.filter(f => f !== id); await dbPut('events', e); }
  for (const g of State.groups) if (g.logoFileId === id) { g.logoFileId = null; await dbPut('groups', g); }
  rebuildIndex();
}
async function openFile(id) {
  const rec = await dbGet('files', id);
  const meta = State.fileMeta.find(f => f.id === id);
  if (!rec || !rec.blob) { Toast.error('Файл не найден в хранилище'); return; }
  const url = URL.createObjectURL(rec.blob);
  if (meta && /^image\//.test(meta.type)) {
    Modal.show(meta.name, '<img src="' + url + '" alt="' + escapeHtml(meta.name) + '" style="width:100%;border-radius:var(--radius);background:#fff">',
      '<button class="btn" type="button" data-modal-close>Закрыть</button><a class="btn btn-primary" href="' + url + '" download="' + escapeHtml(meta.name) + '">Скачать</a>');
    return;
  }
  const a = document.createElement('a');
  a.href = url; a.download = meta ? meta.name : 'file'; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  Toast.info('Файл открыт / сохранён');
}
function fileMetaById(id) { return State.fileMeta.find(f => f.id === id); }
function fileIcon(type) {
  if (/^image\//.test(type || '')) return '🖼️';
  if (/^audio\//.test(type || '')) return '🎧';
  if (/pdf/.test(type || '')) return '📕';
  if (/word|document/.test(type || '')) return '📘';
  if (/text/.test(type || '')) return '📄';
  return '📎';
}
function fileListHTML(ids, kind, ownerId) {
  const list = (ids || []).map(fileMetaById).filter(Boolean);
  return '<div class="form-group"><span class="form-label">Вложенные файлы</span>' +
    (list.length ? '<div class="file-list">' + list.map(f =>
      '<div class="file-row"><span class="f-ico">' + fileIcon(f.type) + '</span>' +
      '<span class="f-name">' + escapeHtml(f.name) + '</span><span class="f-size">' + bytesLabel(f.size) + '</span>' +
      '<button class="btn btn-sm" type="button" data-act="open-file" data-id="' + f.id + '">Открыть</button>' +
      '<button class="btn btn-sm btn-danger" type="button" data-act="delete-file" data-id="' + f.id + '" data-kind="' + kind + '" data-owner="' + (ownerId || '') + '" aria-label="Удалить файл">' + icon('trash', 15) + '</button></div>').join('') + '</div>'
      : '<p class="form-hint">Файлы не прикреплены. Поддерживаются PDF, изображения, аудио и текстовые документы.</p>') +
    '<button class="btn btn-sm mt-2" type="button" data-act="attach-file" data-kind="' + kind + '" data-owner="' + (ownerId || '') + '">' + icon('paperclip', 15) + ' Прикрепить файл</button></div>';
}

/* ═══ SECTION 5: THEME / ACCENT / TYPOGRAPHY / TOAST / MODAL ═══ */
const THEME_NAMES = { light: 'Светлая', dark: 'Тёмная', amoled: 'AMOLED' };
const ACCENTS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#14b8a6', '#0ea5e9', '#64748b'];
const systemMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function resolveTheme() { return State.settings.systemTheme ? ((systemMQ && systemMQ.matches) ? 'dark' : 'light') : State.settings.theme; }
function applyTheme(theme, silent) {
  if (theme === 'system') { State.settings.systemTheme = true; }
  else State.settings.systemTheme = false;
  const effective = resolveTheme();
  document.documentElement.setAttribute('data-theme', effective);
  State.settings.theme = (theme === 'system') ? State.settings.theme : theme;
  const label = $('#themeLabel');
  if (label) label.textContent = State.settings.systemTheme ? 'Системная тема' : (THEME_NAMES[State.settings.theme] + ' тема');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effective === 'light' ? State.settings.accent : (effective === 'amoled' ? '#000000' : '#1a1a2e'));
  writePrefs({ theme: State.settings.theme, systemTheme: State.settings.systemTheme });
  dbPut('meta', { id: 'theme', value: State.settings.theme });
  if (!silent) Toast.info('Тема: ' + (State.settings.systemTheme ? 'Системная' : THEME_NAMES[State.settings.theme]));
}
function toggleTheme() {
  if (State.settings.systemTheme) { applyTheme('light'); return; }
  const order = ['light', 'dark', 'amoled'];
  applyTheme(order[(order.indexOf(State.settings.theme) + 1) % order.length]);
}
function applyAccent(hex, silent) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) hex = '#6366f1';
  const r = document.documentElement;
  r.style.setProperty('--accent', hex);
  r.style.setProperty('--accent-dark', shadeColor(hex, -0.18));
  r.style.setProperty('--accent-light', shadeColor(hex, 0.22));
  r.style.setProperty('--accent-soft', hexToRgba(hex, 0.13));
  State.settings.accent = hex;
  writePrefs({ accent: hex });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && resolveTheme() === 'light') meta.setAttribute('content', hex);
  if (!silent) Toast.success('Акцентный цвет обновлён');
}
function applyTypography() {
  document.documentElement.style.setProperty('--lyrics-font', (State.settings.lyricsFont || 15) + 'px');
  applyReducedMotion();
}
function applyReducedMotion() {
  const on = State.settings.reducedMotion || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.documentElement.setAttribute('data-reduced-motion', on ? 'true' : 'false');
}
function persistSetting(key, value) {
  State.settings[key] = value;
  const patch = {}; patch[key] = value;
  writePrefs(patch);
}
const Toast = {
  show(msg, type, action, ms) {
    const c = $('#toastContainer'); if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    const span = document.createElement('span'); span.textContent = msg; el.appendChild(span);
    if (action && typeof action.fn === 'function') {
      const u = document.createElement('button');
      u.className = 'toast-undo'; u.type = 'button'; u.textContent = action.label || 'Отменить';
      u.addEventListener('click', () => { try { action.fn(); } catch (e) { Logger.error(e); } el.remove(); });
      el.appendChild(u);
    }
    c.appendChild(el);
    setTimeout(() => { el.style.animation = 'toastOut 0.3s forwards'; setTimeout(() => el.remove(), 320); }, ms || (action ? 7000 : 3600));
    while (c.children.length > 3) c.firstChild.remove();
  },
  success(m, a) { this.show(m, 'success', a); },
  error(m) { this.show(m, 'error'); },
  info(m, a) { this.show(m, 'info', a); },
  warning(m) { this.show(m, 'warning'); }
};
const Modal = {
  _lastFocus: null, _onKey: null,
  isOpen() { const o = $('#modalOverlay'); return !!o && o.classList.contains('active'); },
  show(title, bodyHTML, footerHTML, options) {
    const ov = $('#modalOverlay'), opts = options || {};
    ov.innerHTML = '<div class="modal' + (opts.size ? ' ' + opts.size : '') + '" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '">' +
      '<div class="modal-header"><h2 class="modal-title">' + escapeHtml(title) + '</h2>' +
      '<button class="modal-close" type="button" aria-label="Закрыть" data-modal-close>' + icon('x', 18) + '</button></div>' +
      '<div class="modal-body">' + bodyHTML + '</div>' +
      (footerHTML ? '<div class="modal-footer">' + footerHTML + '</div>' : '') + '</div>';
    ov.classList.add('active');
    this._lastFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    const modal = $('.modal', ov);
    setTimeout(() => { const f = modal.querySelector('input:not([type=hidden]), select, textarea, button.btn-primary'); if (f && f.focus) f.focus(); }, 60);
    this._onKey = e => {
      if (e.key !== 'Tab') return;
      const fs = $$('a[href], button:not([disabled]), input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])', modal).filter(x => x.offsetParent !== null);
      if (!fs.length) return;
      const first = fs[0], last = fs[fs.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', this._onKey);
    if (opts.onMount) setTimeout(opts.onMount, 30);
    return modal;
  },
  close() {
    const ov = $('#modalOverlay');
    ov.classList.remove('active'); ov.innerHTML = '';
    document.body.style.overflow = '';
    if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null; }
    if (this._lastFocus && this._lastFocus.focus) { try { this._lastFocus.focus(); } catch (e) {} }
    this._lastFocus = null;
  },
  confirm(title, message, onConfirm, confirmLabel, danger) {
    this.show(title, '<p style="font-size:15px;line-height:1.65">' + escapeHtml(message) + '</p>',
      '<button class="btn" type="button" data-modal-close>Отмена</button>' +
      '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" type="button" id="modalConfirmBtn">' + escapeHtml(confirmLabel || 'Подтвердить') + '</button>',
      { onMount: () => { const b = $('#modalConfirmBtn'); if (b) b.addEventListener('click', () => { Modal.close(); if (onConfirm) onConfirm(); }); } });
  },
  sheet(title, items) {
    this.show(title, '<div class="sheet-list">' + items.map((it, i) =>
      '<button class="sheet-item" type="button" data-sheet="' + i + '"><span class="si-icon">' + (it.icon || '•') + '</span>' +
      '<span style="min-width:0;flex:1">' + escapeHtml(it.label) + (it.sub ? '<small>' + escapeHtml(it.sub) + '</small>' : '') + '</span></button>').join('') + '</div>',
      '<button class="btn" type="button" data-modal-close>Закрыть</button>',
      { onMount: () => { $$('[data-sheet]').forEach(b => b.addEventListener('click', () => { const it = items[parseInt(b.getAttribute('data-sheet'), 10)]; Modal.close(); if (it && it.run) setTimeout(it.run, 40); })); } });
  }
};

/* ═══ SECTION 4: ROUTER ═══ */
function parseRoute() {
  let h = (window.location.hash || '').replace(/^#/, '');
  if (!h) h = '/calendar';
  if (h[0] !== '/') h = '/' + h;
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  return { full: '/' + parts.join('/'), parts, base: '/' + (parts[0] || 'calendar') };
}
function navigate(route) { let r = String(route || '/calendar'); if (r[0] !== '#') r = '#' + r; if (window.location.hash === r) handleRoute(); else window.location.hash = r; }
const TAB_BY_BASE = { '/calendar': 'calendar', '/songs': 'songs', '/band': 'band', '/setlists': 'band', '/groups': 'band', '/members': 'band', '/more': 'more', '/settings': 'more', '/scene': 'band', '/dashboard': 'calendar' };
function handleRoute() {
  const rt = parseRoute();
  if (rt.base === '/dashboard' || rt.base === '/') { navigate('#/calendar'); return; }
  State.ui.route = rt.full; State.ui.parts = rt.parts; State.ui.base = rt.base;
  State.ui.tab = TAB_BY_BASE[rt.base] || 'calendar';
  closeSearchDropdown();
  updateNav(State.ui.tab);
  const c = $('#content'); if (c) c.scrollTop = 0;
  try {
    switch (rt.base) {
      case '/calendar': renderCalendar(); break;
      case '/songs': rt.parts[1] ? renderSongDetail(rt.parts[1]) : renderSongs(); break;
      case '/band':
        if (rt.parts[1] === 'setlist' && rt.parts[2]) renderSetlistDetail(rt.parts[2]);
        else if (rt.parts[1] === 'group' && rt.parts[2]) renderGroupDetail(rt.parts[2]);
        else renderBand();
        break;
      case '/setlists': rt.parts[1] ? renderSetlistDetail(rt.parts[1]) : (State.ui.bandTab = 'setlists', renderBand()); break;
      case '/groups': rt.parts[1] ? renderGroupDetail(rt.parts[1]) : (State.ui.bandTab = 'groups', renderBand()); break;
      case '/members': State.ui.bandTab = 'members'; renderBand(); break;
      case '/scene': renderScenePage(); break;
      case '/more': case '/settings': renderMore(); break;
      default: renderNotFound(rt.full);
    }
  } catch (err) {
    Logger.error('route', err);
    c.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Не удалось отобразить раздел</div>' +
      '<div class="empty-state-text">Данные сохранены локально и в безопасности. Попробуйте открыть другой раздел.</div>' +
      '<button class="btn btn-primary" data-go="#/calendar">В календарь</button></div>';
  }
  updateNavCounts();
}
function renderNotFound(p) {
  $('#content').innerHTML = '<div class="empty-state"><div class="empty-state-icon">🧭</div><div class="empty-state-title">Страница не найдена</div>' +
    '<div class="empty-state-text">Маршрут ' + escapeHtml(p) + ' не существует.</div><button class="btn btn-primary" data-go="#/calendar">В календарь</button></div>';
}
function updateNav(tab) {
  $$('.nav-item[data-tab]').forEach(i => i.classList.toggle('active', i.getAttribute('data-tab') === tab));
  $$('.bnav-item[data-tab]').forEach(i => i.classList.toggle('active', i.getAttribute('data-tab') === tab));
}
const updateNavCounts = throttleRAF(function () {
  const now = new Date();
  const up = expandOccurrences(now, new Date(now.getTime() + 86400000 * 60)).length;
  const setTxt = (sel, v) => { const e = $(sel); if (e) e.textContent = v > 0 ? String(v) : ''; };
  setTxt('#navCountEvents', up);
  setTxt('#navCountSongs', State.songs.length);
  setTxt('#navCountSets', State.setlists.length);
  const badge = $('#bnavBadgeEvents');
  if (badge) { const t = occurrencesOnDate(new Date()).length; badge.textContent = String(t); badge.hidden = t === 0; }
});

/* ═══ PERF: chunked rendering ═══ */
function renderChunked(container, items, rowHtml, chunkSize) {
  const size = chunkSize || 28;
  container.innerHTML = '';
  if (!items.length) return false;
  let idx = 0;
  const next = () => { const end = Math.min(idx + size, items.length); let h = ''; for (; idx < end; idx++) h += rowHtml(items[idx], idx); return h; };
  const holder = document.createElement('div');
  holder.className = 'chunk-holder';
  holder.innerHTML = next();
  container.appendChild(holder);
  if (idx < items.length) {
    const sentinel = document.createElement('div');
    sentinel.className = 'chunk-sentinel';
    container.appendChild(sentinel);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        for (const en of entries) if (en.isIntersecting) {
          holder.insertAdjacentHTML('beforeend', next());
          if (idx >= items.length) { io.disconnect(); sentinel.remove(); }
        }
      }, { root: $('#content'), rootMargin: '700px' });
      io.observe(sentinel);
    } else { while (idx < items.length) holder.insertAdjacentHTML('beforeend', next()); sentinel.remove(); }
  }
  return true;
}
function emptyBlock(ico, title, text, act, label, arg) {
  return '<div class="empty-state"><div class="empty-state-icon">' + ico + '</div>' +
    '<div class="empty-state-title">' + escapeHtml(title) + '</div>' +
    '<div class="empty-state-text">' + escapeHtml(text) + '</div>' +
    (act ? '<button class="btn btn-primary" type="button" data-act="' + act + '"' + (arg ? ' data-id="' + arg + '"' : '') + '>' + escapeHtml(label) + '</button>' : '') + '</div>';
}

/* ═══ CHORD PARSER & TRANSPOSITION ═══ */
const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_MAP = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const CHORD_TOKEN_RE = /^[A-G][#b]?(?:maj|min|maj7|min7|m7|m6|m9|m|dim|aug|sus2|sus4|sus|add9|add|alt|o|\+|-)?[0-9]*(?:[#b0-9+\-]*)?(?:\/[A-G][#b]?)?$/;
const CHORD_PARSE_RE = /^([A-G])([#b])?([\s\S]*?)(?:\/([A-G])([#b])?)?$/;
function isChordToken(t) { return !!t && CHORD_TOKEN_RE.test(t.trim()); }
function parseChord(chord) {
  if (!chord) return null;
  const m = String(chord).trim().match(CHORD_PARSE_RE);
  if (!m) return null;
  const rootName = m[1] + (m[2] || '');
  const rootIdx = KEY_MAP[rootName];
  if (rootIdx === undefined) return null;
  let bassIdx = null, bassFlat = false;
  if (m[4]) { const bn = m[4] + (m[5] || ''); bassIdx = KEY_MAP[bn]; if (bassIdx === undefined) return null; bassFlat = m[5] === 'b'; }
  return { rootIdx, suffix: m[3] || '', bassIdx, isFlat: m[2] === 'b', bassFlat };
}
function noteName(idx, preferFlat) {
  const fmt = State.settings.chordFormat;
  const flat = fmt === 'flat' ? true : (fmt === 'sharp' ? false : preferFlat);
  return flat ? FLAT_NOTES[idx] : SHARP_NOTES[idx];
}
function transposeChord(chord, semitones) {
  const p = parseChord(chord);
  if (!p) return chord;
  if (!semitones && State.settings.chordFormat === 'auto') return chord;
  let out = noteName((p.rootIdx + (semitones || 0) + 120) % 12, p.isFlat) + p.suffix;
  if (p.bassIdx !== null) out += '/' + noteName((p.bassIdx + (semitones || 0) + 120) % 12, p.bassFlat || p.isFlat);
  return out;
}
function transposeKey(key, semitones) { if (!key) return key; return String(key).split(/(\s+)/).map(t => isChordToken(t) ? transposeChord(t, semitones) : t).join(''); }
function isChordLine(line) {
  const s = String(line || '').trim();
  if (!s) return false;
  const t = s.split(/\s+/);
  for (let i = 0; i < t.length; i++) if (!isChordToken(t[i])) return false;
  return true;
}
function renderChordLine(line, tr) {
  let out = '', last = 0, m; const re = /[A-G][#b]?[^\s]*/g;
  while ((m = re.exec(line)) !== null) {
    out += escapeHtml(line.slice(last, m.index));
    out += isChordToken(m[0]) ? '<span class="chord">' + escapeHtml(transposeChord(m[0], tr)) + '</span>' : escapeHtml(m[0]);
    last = re.lastIndex;
  }
  return out + escapeHtml(line.slice(last));
}
function renderLyrics(lyrics, tr) {
  const text = String(lyrics || '');
  if (!text.trim()) return '<p class="text-muted">Текст песни не добавлен. Нажмите «Изменить», чтобы вставить текст с аккордами.</p>';
  const lines = text.split('\n');
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    const sec = lines[i].match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec) { html += '<span class="section-label">' + escapeHtml(sec[1]) + '</span>\n'; continue; }
    html += (isChordLine(lines[i]) ? renderChordLine(lines[i], tr || 0) : escapeHtml(lines[i])) + '\n';
  }
  return '<div class="lyrics-view">' + html.replace(/\n$/, '') + '</div>';
}
function extractChords(lyrics) {
  const out = [], seen = {};
  String(lyrics || '').split('\n').forEach(l => { if (!isChordLine(l)) return; l.trim().split(/\s+/).forEach(t => { if (isChordToken(t) && !seen[t]) { seen[t] = 1; out.push(t); } }); });
  return out;
}
function transposeLyricsText(lyrics, tr) {
  return String(lyrics || '').split('\n').map(l => isChordLine(l) && tr ? l.replace(/[A-G][#b]?[^\s]*/g, t => isChordToken(t) ? transposeChord(t, tr) : t) : l).join('\n');
}

/* ═══ RECURRENCE ENGINE ═══ */
const REPEATS = { none: 'Без повтора', daily: 'Каждый день', weekly: 'Каждую неделю', biweekly: 'Каждые 2 недели', monthly: 'Каждый месяц' };
function nextOccurrence(d, e) {
  const x = new Date(d.getTime());
  const rep = e.repeat || 'none';
  const iv = e.repeatInterval || 1;
  if (rep === 'daily') x.setDate(x.getDate() + iv);
  else if (rep === 'weekly') x.setDate(x.getDate() + 7 * iv);
  else if (rep === 'biweekly') x.setDate(x.getDate() + 14);
  else if (rep === 'monthly') x.setMonth(x.getMonth() + iv);
  else x.setFullYear(x.getFullYear() + 100);
  return x;
}
function occurrencesOf(e, from, to) {
  const out = [];
  const s = new Date(e.start), en = new Date(e.end || e.start);
  if (isNaN(s)) return out;
  const dur = Math.max(600000, en - s);
  const ex = e.exdates || [];
  if ((e.repeat || 'none') === 'none') {
    const end = new Date(s.getTime() + dur);
    if (end >= from && s <= to) out.push({ start: s, end, key: e.id + '@' + dateKey(s), single: true });
    return out;
  }
  const until = e.repeatUntil ? startOfDay(new Date(e.repeatUntil)) : null;
  const max = e.repeatCount || 300;
  let cur = new Date(s.getTime()), n = 0;
  while (cur <= to && n < max) {
    if (until && startOfDay(cur) > until) break;
    const end = new Date(cur.getTime() + dur);
    if (end >= from) {
      const k = dateKey(cur);
      if (ex.indexOf(k) < 0) out.push({ start: new Date(cur), end, key: e.id + '@' + k, single: false });
    }
    cur = nextOccurrence(cur, e);
    n++;
    if (n > 400) break;
  }
  return out;
}
let _expCache = { sig: null, list: [] };
function expandOccurrences(from, to) {
  const f = State.ui.filters;
  const sig = [from.getTime(), to.getTime(), State.events.length, f.groupId, (f.types || []).join(','), f.query, f.onlyMine, State.activity.length].join('|');
  if (_expCache.sig === sig) return _expCache.list;
  const q = (f.query || '').toLowerCase().trim();
  const list = [];
  for (let i = 0; i < State.events.length; i++) {
    const e = State.events[i];
    if (e.status === 'cancelled') continue;
    if (f.groupId && e.groupId !== f.groupId) continue;
    if (f.types && f.types.length && f.types.indexOf(e.type) < 0) continue;
    if (f.onlyMine && e.myStatus !== 'yes') continue;
    if (q && (e.title || '').toLowerCase().indexOf(q) < 0 && (e.location || '').toLowerCase().indexOf(q < 0 ? q : q) < 0 && groupName(e.groupId).toLowerCase().indexOf(q) < 0) continue;
    const occ = occurrencesOf(e, from, to);
    for (let j = 0; j < occ.length; j++) list.push({ ev: e, start: occ[j].start, end: occ[j].end, key: occ[j].key, single: occ[j].single });
  }
  list.sort((a, b) => a.start - b.start);
  _expCache = { sig, list };
  return list;
}
function occurrencesOnDate(d) {
  const s = startOfDay(d), e = new Date(s.getTime() + 86400000);
  return expandOccurrences(s, e).filter(o => dateKey(o.start) === dateKey(s));
}
function upcomingOccurrences(limit, from) {
  const now = from || new Date();
  const list = expandOccurrences(now, new Date(now.getTime() + 86400000 * 400));
  return limit ? list.slice(0, limit) : list;
}

/* ═══ SHARED FRAGMENTS ═══ */
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const EVENT_TYPES = { worship: 'Служение', rehearsal: 'Репетиция', concert: 'Концерт', meeting: 'Встреча', participation: 'Участие', personal: 'Личное напоминание' };
const TYPE_COLORS = { worship: '#a855f7', rehearsal: '#22c55e', concert: '#ef4444', meeting: '#f59e0b', participation: '#0ea5e9', personal: '#14b8a6' };
const MY_STATUS = { yes: 'Участвую', maybe: 'Под вопросом', no: 'Не участвую' };
const MEMBER_STATUS = { active: 'Активен', paused: 'Временно не участвует', invited: 'Приглашён', archived: 'Архивирован' };
const SETLIST_STATUS = { draft: 'Черновик', active: 'Активный', done: 'Проведённый', archived: 'Архивный' };
const PARTICIPANT_STATUS = { confirmed: 'Участвую', pending: 'Под вопросом', declined: 'Не участвую' };
const BASE_ROLES = ['Vocal', 'Guitar', 'Keys', 'Bass', 'Drums', 'Strings', 'Brass', 'Sound', 'Leader', 'Organizer', 'Tech', 'Other'];
const ROLE_COLORS = { Vocal: '#6366f1', Guitar: '#22c55e', Keys: '#8b5cf6', Bass: '#f59e0b', Drums: '#ef4444', Strings: '#14b8a6', Brass: '#ec4899', Sound: '#64748b', Leader: '#0ea5e9', Organizer: '#f97316', Tech: '#84cc16', Other: '#9ca3af' };
function allRoles() { return BASE_ROLES.concat(State.settings.customRoles || []); }
function weekStartOffset(d) { return (d.getDay() + 7 - (State.settings.weekStart === 0 ? 0 : 1)) % 7; }
function weekStartDate(d) { const x = startOfDay(d); x.setDate(x.getDate() - weekStartOffset(x)); return x; }
function weekdayLabels() { const out = []; const base = State.settings.weekStart === 0 ? 0 : 1; for (let i = 0; i < 7; i++) out.push(WD[(base + i) % 7]); return out; }
function dateBlockHTML(d, withTime) {
  const x = toDate(d);
  return '<div class="date-block"><div class="date-block-weekday">' + WD[x.getDay()] + '</div>' +
    '<div class="date-block-day">' + x.getDate() + '</div>' +
    '<div class="date-block-month">' + escapeHtml(x.toLocaleDateString('ru-RU', { month: 'short' })) + '</div>' +
    (withTime ? '<div class="date-block-time">' + formatTime(x) + '</div>' : '') + '</div>';
}
function countdownText(t) {
  const diff = new Date(t) - new Date();
  if (diff <= 0) return 'идёт сейчас';
  const m = Math.floor(diff / 60000);
  if (m < 60) return 'через ' + m + ' мин';
  const h = Math.floor(m / 60);
  if (h < 24) return 'через ' + h + ' ' + plural(h, 'час', 'часа', 'часов');
  const d = Math.floor(h / 24);
  return 'через ' + d + ' ' + plural(d, 'день', 'дня', 'дней');
}
function participantsHTML(e) {
  const parts = e.participants || [];
  if (!parts.length) return '<div class="event-participants"><span class="p-count">Состав не назначен</span></div>';
  const shown = parts.slice(0, 6), rest = parts.length - shown.length;
  const yes = parts.filter(p => p.status === 'confirmed').length;
  const maybe = parts.filter(p => p.status === 'pending').length;
  let av = '<span class="avatar-stack">';
  shown.forEach(p => { const m = findMember(p.memberId); if (!m) return; av += '<span class="mini-avatar" style="background:' + escapeHtml(m.color || 'var(--accent)') + '" title="' + escapeHtml(m.name) + '">' + escapeHtml((m.name || '?')[0].toUpperCase()) + '</span>'; });
  if (rest > 0) av += '<span class="mini-avatar mini-more">+' + rest + '</span>';
  av += '</span>';
  return '<div class="event-participants">' + av + '<span class="p-count">' + parts.length + ' ' + plural(parts.length, 'участник', 'участника', 'участников') +
    ' · ' + yes + ' участв.' + (maybe ? ' · ' + maybe + ' под вопр.' : '') + '</span></div>';
}
function occurrenceCardHTML(o, withActions) {
  const e = o.ev;
  const sl = e.setlistId ? findSetlist(e.setlistId) : null;
  const count = sl ? (sl.items || []).length : 0;
  const gn = groupName(e.groupId);
  const color = e.color || TYPE_COLORS[e.type] || groupColor(e.groupId);
  const future = o.start > new Date();
  const myBadge = e.myStatus ? '<span class="badge ' + (e.myStatus === 'yes' ? 'badge-success' : e.myStatus === 'no' ? 'badge-danger' : 'badge-warning') + '">' + MY_STATUS[e.myStatus] + '</span>' : '';
  const repBadge = (e.repeat && e.repeat !== 'none') ? '<span class="badge badge-muted">' + icon('repeat', 12) + ' ' + REPEATS[e.repeat] + '</span>' : '';
  return '<article class="event-card" data-event="' + e.id + '" data-occ="' + dateKey(o.start) + '" role="button" tabindex="0" style="border-left-color:' + escapeHtml(color) + '">' +
    dateBlockHTML(o.start, false) +
    '<div class="event-body">' +
      '<div class="event-title">' + escapeHtml(e.title) + '</div>' +
      '<div class="event-meta"><span>' + icon('clock', 13) + ' ' + formatTime(o.start) + '–' + formatTime(o.end) +
        (future ? ' · <b data-countdown="' + e.id + '|' + o.start.toISOString() + '">' + escapeHtml(countdownText(o.start)) + '</b>' : '') + '</span>' +
        (e.location ? '<span>' + icon('pin', 13) + ' ' + escapeHtml(e.location) + '</span>' : '') +
        (count ? '<span>' + icon('music', 13) + ' ' + count + ' ' + plural(count, 'песня', 'песни', 'песен') + '</span>' : '') +
        '<span>' + escapeHtml(EVENT_TYPES[e.type] || 'Событие') + '</span></div>' +
      (gn ? '<div class="event-group"><span class="group-dot" style="background:' + escapeHtml(color) + '"></span>' + escapeHtml(gn) + '</div>' : '') +
      '<div class="flex gap-2 flex-wrap items-center mt-2">' + myBadge + repBadge + '</div>' +
      participantsHTML(e) +
      '<div class="part-switch mt-2" role="group" aria-label="Ваше участие">' +
        ['yes', 'maybe', 'no'].map(s => '<button class="part-btn' + (e.myStatus === s ? ' on' : '') + '" type="button" data-act="my-status" data-id="' + e.id + '" data-val="' + s + '">' + MY_STATUS[s] + '</button>').join('') +
      '</div>' +
      (withActions ? '<div class="event-card-actions">' +
        (e.setlistId ? '<button class="btn btn-sm" type="button" data-go="#/band/setlist/' + e.setlistId + '">Сет-лист</button>' : '<button class="btn btn-sm" type="button" data-act="setlist-for-event" data-id="' + e.id + '">Сет-лист</button>') +
        '<button class="btn btn-sm btn-primary" type="button" data-act="scene-from-event" data-id="' + e.id + '">' + icon('stage', 15) + 'Сцена</button>' +
        '<button class="btn btn-sm" type="button" data-act="event-details" data-id="' + e.id + '" data-occ="' + dateKey(o.start) + '">Подробнее</button>' +
      '</div>' : '') +
    '</div></article>';
}

/* ═══ SECTION 7: CALENDAR TAB ═══ */
const GRID_START = 7, GRID_END = 24, PX_PER_MIN = 1, SNAP = 5;
function renderCalendar() {
  const c = $('#content');
  const up = upcomingOccurrences(4);
  c.innerHTML =
    '<div class="page-header"><div><h1 class="page-title">Календарь</h1>' +
      '<p class="page-subtitle">События, участия, напоминания и расписание групп</p></div>' +
      '<div class="page-actions"><button class="btn" type="button" data-act="cal-today">' + icon('calendar', 18) + 'Сегодня</button>' +
      '<button class="btn btn-primary" type="button" data-act="new-event">' + icon('plus', 18) + 'Событие</button></div></div>' +

    '<section class="card mb-4"><h2 class="section-title">Ближайшие события</h2>' +
      (up.length ? up.map(o => occurrenceCardHTML(o, true)).join('') : emptyBlock('📅', 'Нет предстоящих событий', 'Создайте репетицию, выступление, служение или личное напоминание — они появятся здесь и в календаре.', 'new-event', 'Создать событие')) +
    '</section>' +

    '<div class="calendar-header">' +
      '<div class="calendar-nav">' +
        '<button class="icon-btn" type="button" data-act="cal-nav" data-dir="-1" aria-label="Назад">' + icon('left', 20) + '</button>' +
        '<div class="calendar-title" id="calTitle" aria-live="polite">' + escapeHtml(calendarTitle()) + '</div>' +
        '<button class="icon-btn" type="button" data-act="cal-nav" data-dir="1" aria-label="Вперёд">' + icon('right', 20) + '</button>' +
      '</div>' +
      '<div class="calendar-view-tabs" role="tablist" aria-label="Вид календаря">' +
        ['month', 'week', 'day', 'agenda'].map(v => '<button class="calendar-tab' + (State.ui.calendarView === v ? ' active' : '') + '" role="tab" aria-selected="' + (State.ui.calendarView === v) + '" type="button" data-act="cal-view" data-val="' + v + '">' + ({ month: 'Месяц', week: 'Неделя', day: 'День', agenda: 'Список' })[v] + '</button>').join('') +
      '</div>' +
    '</div>' +

    '<div class="calendar-filters">' +
      '<span class="badge badge-muted">' + icon('filter', 14) + ' Фильтры</span>' +
      '<select class="form-select" id="calGroupFilter" aria-label="Группа"><option value="">Все группы</option>' +
        State.groups.map(g => '<option value="' + g.id + '"' + (State.ui.filters.groupId === g.id ? ' selected' : '') + '>' + escapeHtml(g.name) + (g.status === 'archived' ? ' (архив)' : '') + '</option>').join('') + '</select>' +
      '<div class="filter-search">' + icon('search', 16) + '<input type="search" id="calSearch" placeholder="Поиск событий…" value="' + escapeHtml(State.ui.filters.query) + '" aria-label="Поиск событий"></div>' +
      '<label class="chip' + (State.ui.filters.onlyMine ? ' active' : '') + '"><input type="checkbox" id="calOnlyMine"' + (State.ui.filters.onlyMine ? ' checked' : '') + '>Только я участвую</label>' +
      '<div class="chip-row" id="calTypeChips">' + Object.keys(EVENT_TYPES).map(t =>
        '<label class="chip' + (State.ui.filters.types.indexOf(t) >= 0 ? ' active' : '') + '"><input type="checkbox" value="' + t + '"' + (State.ui.filters.types.indexOf(t) >= 0 ? ' checked' : '') + '>' + EVENT_TYPES[t] + '</label>').join('') + '</div>' +
    '</div><div id="calendarContent"></div>';

  const gf = $('#calGroupFilter');
  if (gf) gf.addEventListener('change', () => { State.ui.filters.groupId = gf.value; renderCalendarContent(); }, { passive: true });
  const cs = $('#calSearch');
  if (cs) cs.addEventListener('input', debounce(() => { State.ui.filters.query = cs.value; renderCalendarContent(); }, 180), { passive: true });
  const om = $('#calOnlyMine');
  if (om) om.addEventListener('change', () => { State.ui.filters.onlyMine = om.checked; om.closest('.chip').classList.toggle('active', om.checked); renderCalendarContent(); }, { passive: true });
  $$('#calTypeChips input').forEach(cb => cb.addEventListener('change', () => {
    const a = State.ui.filters.types, i = a.indexOf(cb.value);
    if (cb.checked && i < 0) a.push(cb.value);
    if (!cb.checked && i >= 0) a.splice(i, 1);
    cb.closest('.chip').classList.toggle('active', cb.checked);
    renderCalendarContent();
  }, { passive: true }));
  renderCalendarContent();
}
function calendarTitle() {
  const d = State.ui.calendarDate, v = State.ui.calendarView;
  if (v === 'month') return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  if (v === 'week') { const s = weekStartDate(d), e = new Date(s); e.setDate(s.getDate() + 6); return s.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' — ' + e.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); }
  if (v === 'day') return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return 'Список событий';
}
function calendarNav(dir) {
  const d = new Date(State.ui.calendarDate), v = State.ui.calendarView;
  if (v === 'month') d.setMonth(d.getMonth() + dir);
  else if (v === 'week') d.setDate(d.getDate() + dir * 7);
  else if (v === 'day') d.setDate(d.getDate() + dir);
  else d.setDate(d.getDate() + dir * 14);
  State.ui.calendarDate = d; renderCalendar();
}
function setCalendarView(v) { State.ui.calendarView = v; State.settings.defaultView = v; writePrefs({ defaultView: v }); renderCalendar(); }
function goToToday() { State.ui.calendarDate = new Date(); renderCalendar(); }
function renderCalendarContent() {
  const el = $('#calendarContent'); if (!el) return;
  const t = $('#calTitle'); if (t) t.textContent = calendarTitle();
  const v = State.ui.calendarView;
  if (v === 'month') renderMonthView(el);
  else if (v === 'week') renderTimeGrid(el, weekDays(State.ui.calendarDate));
  else if (v === 'day') renderDayView(el);
  else renderAgenda(el);
}
function weekDays(d) { const s = weekStartDate(d), o = []; for (let i = 0; i < 7; i++) { const x = new Date(s); x.setDate(s.getDate() + i); o.push(x); } return o; }
function renderMonthView(el) {
  const d = State.ui.calendarDate, y = d.getFullYear(), m = d.getMonth();
  const gridStart = weekStartDate(new Date(y, m, 1));
  const cells = [];
  for (let i = 0; i < 42; i++) { const x = new Date(gridStart); x.setDate(gridStart.getDate() + i); cells.push(x); }
  const last = cells[cells.length - 1];
  const occ = expandOccurrences(startOfDay(gridStart), new Date(last.getTime() + 86400000));
  const byDay = new Map();
  occ.forEach(o => { const k = dateKey(o.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(o); });
  const todayK = dateKey(new Date());
  const selK = State.ui.selectedDate ? dateKey(State.ui.selectedDate) : null;
  let html = '<div class="calendar-grid" role="grid" aria-label="Календарь на месяц">';
  weekdayLabels().forEach(w => { html += '<div class="calendar-weekday" role="columnheader">' + w + '</div>'; });
  cells.forEach(c => {
    const k = dateKey(c);
    const list = byDay.get(k) || [];
    const cls = ['calendar-day'];
    if (c.getMonth() !== m) cls.push('other-month');
    if (k === todayK) cls.push('today');
    if (k === selK) cls.push('selected');
    const dots = list.slice(0, 3).map(o => '<div class="calendar-event-dot type-' + escapeHtml(o.ev.type) + '" data-drag-event="' + o.ev.id + '" data-occ="' + k + '" role="button" tabindex="0" aria-label="' + escapeHtml(o.ev.title + ', ' + formatTime(o.start)) + '">' + formatTime(o.start) + ' ' + escapeHtml(o.ev.title) + '</div>').join('');
    const more = list.length > 3 ? '<div class="calendar-more">+' + (list.length - 3) + ' ещё</div>' : '';
    html += '<div class="' + cls.join(' ') + '" data-day="' + k + '" role="gridcell" tabindex="0" aria-label="' + escapeHtml(c.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })) + ', событий: ' + list.length + '">' +
      '<div class="calendar-day-num">' + c.getDate() + '</div><div class="calendar-day-events">' + dots + more + '</div></div>';
  });
  html += '</div>';
  el.innerHTML = html;
  $$('.calendar-event-dot', el).forEach(chip => setupChipDrag(chip, el));
}
function setupChipDrag(chip, root) {
  const id = chip.getAttribute('data-drag-event'), occ = chip.getAttribute('data-occ');
  makeDraggable(chip, {
    onStart() {
      State.ui.dragging = true;
      const e = findEvent(id);
      const g = document.createElement('div');
      g.className = 'event-drag-ghost'; g.id = 'dragGhost'; g.textContent = e ? e.title : '';
      document.body.appendChild(g);
      chip.style.opacity = '0.35';
    },
    onMove(ev) {
      const g = $('#dragGhost'); if (g) { g.style.left = (ev.clientX + 12) + 'px'; g.style.top = (ev.clientY + 12) + 'px'; }
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = t && t.closest ? t.closest('.calendar-day') : null;
      $$('.calendar-day', root).forEach(c => c.classList.toggle('drop-target', c === cell));
    },
    onEnd(ev) {
      State.ui.dragging = false;
      const g = $('#dragGhost'); if (g) g.remove();
      chip.style.opacity = '';
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = t && t.closest ? t.closest('.calendar-day') : null;
      $$('.calendar-day', root).forEach(c => c.classList.remove('drop-target'));
      if (cell) moveOccurrence(id, occ, cell.getAttribute('data-day'));
    },
    onTap() { openEventDetails(id, occ); }
  });
  chip.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); openEventDetails(id, occ); } });
}
async function moveOccurrence(eventId, fromKey, toKey) {
  const e = findEvent(eventId);
  if (!e || !toKey || fromKey === toKey) return;
  const isSeries = (e.repeat || 'none') !== 'none';
  if (isSeries) {
    Modal.confirm('Перенести повтор', '«' + e.title + '» повторяется (' + REPEATS[e.repeat] + '). Перенести только это вхождение (' + formatDate(fromKey) + ') или всю серию?', async () => {
      await detachOccurrence(e, fromKey, toKey);
    }, 'Только это вхождение');
    Modal.show('Перенос серии', '<p style="font-size:15px;line-height:1.65">Перенести всю серию «' + escapeHtml(e.title) + '» на новое время? Все будущие повторения сдвинутся.</p>',
      '<button class="btn" type="button" data-modal-close>Отмена</button><button class="btn btn-primary" type="button" id="seriesMoveBtn">Перенести серию</button>',
      { onMount: () => { $('#seriesMoveBtn').addEventListener('click', async () => { Modal.close(); await shiftSeries(e, fromKey, toKey); }); } });
    return;
  }
  const copy = JSON.parse(JSON.stringify(e));
  const p = toKey.split('-').map(Number);
  const s = new Date(e.start);
  const ns = new Date(p[0], p[1] - 1, p[2], s.getHours(), s.getMinutes(), 0, 0);
  const dur = new Date(e.end || e.start) - s;
  e.start = ns.toISOString(); e.end = new Date(ns.getTime() + dur).toISOString();
  await saveEvent(e);
  await logActivity('event', 'Событие «' + e.title + '» перенесено на ' + formatDate(ns), e.id);
  Toast.success('Перенесено на ' + formatDateShort(ns), { label: 'Отменить', fn: async () => { await saveEvent(copy); refreshCalendar(); } });
  refreshCalendar();
}
async function shiftSeries(e, fromKey, toKey) {
  const copy = JSON.parse(JSON.stringify(e));
  const s = new Date(e.start), en = new Date(e.end || e.start);
  const diffDays = daysBetween(fromKey, toKey);
  const ns = new Date(s); ns.setDate(ns.getDate() + diffDays);
  e.start = ns.toISOString(); e.end = new Date(ns.getTime() + (en - s)).toISOString();
  await saveEvent(e);
  await logActivity('event', 'Серия «' + e.title + '» перенесена на ' + diffDays + ' дн.', e.id);
  Toast.success('Серия перенесена', { label: 'Отменить', fn: async () => { await saveEvent(copy); refreshCalendar(); } });
  refreshCalendar();
}
async function detachOccurrence(e, occKey, newKey) {
  const occ = occurrencesOf(e, startOfDay(occKey), new Date(startOfDay(occKey).getTime() + 86400000))[0];
  if (!occ) { Toast.error('Вхождение не найдено'); return; }
  const copyMaster = JSON.parse(JSON.stringify(e));
  e.exdates = (e.exdates || []).concat([occKey]);
  await saveEvent(e);
  const p = (newKey || occKey).split('-').map(Number);
  const ns = new Date(p[0], p[1] - 1, p[2], occ.start.getHours(), occ.start.getMinutes(), 0, 0);
  const ex = JSON.parse(JSON.stringify(e));
  ex.id = uid('evt'); ex.repeat = 'none'; ex.repeatUntil = null; ex.exdates = [];
  ex.exceptionOf = e.id; ex.start = ns.toISOString();
  ex.end = new Date(ns.getTime() + (occ.end - occ.start)).toISOString();
  ex.createdAt = nowISO();
  await saveEvent(ex);
  await logActivity('event', 'Создано исключение серии «' + e.title + '» на ' + formatDate(ns), ex.id);
  Toast.success('Вхождение перенесено отдельно', {
    label: 'Отменить', fn: async () => { await deleteEvent(ex.id); await saveEvent(copyMaster); refreshCalendar(); }
  });
  refreshCalendar();
}
function refreshCalendar() {
  if (State.ui.base === '/calendar') renderCalendarContent();
  updateNavCounts();
}
function renderTimeGrid(el, days) {
  const hours = []; for (let h = GRID_START; h < GRID_END; h++) hours.push(h);
  const gridH = hours.length * 60;
  const todayK = dateKey(new Date()), now = new Date();
  let head = '<div class="tgrid-head"><div class="tgrid-gutter"></div>';
  days.forEach(d => {
    const k = dateKey(d);
    head += '<div class="tgrid-head-cell' + (k === todayK ? ' is-today' : '') + '" data-day="' + k + '" role="button" tabindex="0">' +
      escapeHtml(d.toLocaleDateString('ru-RU', { weekday: 'short' })) + '<span class="tgrid-head-num">' + d.getDate() + '</span></div>';
  });
  head += '</div>';
  const from = new Date(days[0]); from.setHours(GRID_START, 0, 0, 0);
  const to = new Date(days[days.length - 1]); to.setHours(GRID_END, 0, 0, 0);
  const occ = expandOccurrences(from, to);
  let body = '<div class="tgrid-body" id="tgridBody"><div class="tgrid-times">';
  hours.forEach(h => { body += '<div class="tgrid-hour">' + formatTime(new Date(2000, 0, 1, h, 0)) + '</div>'; });
  body += '</div><div class="tgrid-cols">';
  days.forEach(d => {
    const k = dateKey(d);
    const dayOcc = occ.filter(o => dateKey(o.start) === k);
    const lanes = layoutLanes(dayOcc);
    body += '<div class="tgrid-col" data-date="' + k + '" style="height:' + gridH + 'px">';
    hours.forEach(h => { body += '<div class="tgrid-line" data-hour="' + h + '"></div>'; });
    dayOcc.forEach(o => {
      const s = o.start, en = o.end;
      const sMin = clamp(s.getHours() * 60 + s.getMinutes(), GRID_START * 60, GRID_END * 60);
      const eMin = clamp(en.getHours() * 60 + en.getMinutes() + (dateKey(en) !== k ? 1440 : 0), sMin + 20, GRID_END * 60);
      const top = (sMin - GRID_START * 60) * PX_PER_MIN, h = Math.max(22, (eMin - sMin) * PX_PER_MIN - 2);
      const lane = lanes[o.key] || { i: 0, n: 1 }, w = 100 / lane.n, left = lane.i * w;
      const color = o.ev.color || TYPE_COLORS[o.ev.type] || 'var(--accent)';
      body += '<div class="tgrid-event" data-id="' + o.ev.id + '" data-occ="' + k + '" role="button" tabindex="0" ' +
        'style="top:' + top + 'px;height:' + h + 'px;left:calc(' + left + '% + 2px);width:calc(' + w + '% - 6px);border-left-color:' + escapeHtml(color) + ';background:' + hexToRgba(color.charAt(0) === '#' ? color : '#6366f1', 0.16) + '">' +
        '<div class="tgrid-event-title">' + escapeHtml(o.ev.title) + '</div>' +
        '<div class="tgrid-event-time">' + formatTime(s) + '–' + formatTime(en) + '</div>' +
        '<div class="tgrid-resize" data-resize="1" aria-hidden="true"></div></div>';
    });
    if (k === todayK) {
      const mins = now.getHours() * 60 + now.getMinutes() - GRID_START * 60;
      if (mins >= 0 && mins <= gridH) body += '<div class="tgrid-now" id="tgridNow" style="top:' + mins * PX_PER_MIN + 'px"></div>';
    }
    body += '</div>';
  });
  body += '</div></div>';
  el.innerHTML = '<div class="tgrid">' + head + body + '</div>';
  const b = $('#tgridBody', el);
  if (b) b.scrollTop = clamp((now.getHours() - GRID_START - 1) * 60, 0, gridH);
  $$('.tgrid-col', el).forEach(col => col.addEventListener('dblclick', ev => {
    if (ev.target.closest('.tgrid-event')) return;
    const r = col.getBoundingClientRect();
    createEventAt(col.getAttribute('data-date'), GRID_START * 60 + Math.round((ev.clientY - r.top) / PX_PER_MIN / 15) * 15);
  }));
  $$('.tgrid-head-cell', el).forEach(h => h.addEventListener('click', () => { State.ui.calendarDate = new Date(h.getAttribute('data-day') + 'T12:00:00'); setCalendarView('day'); }));
  $$('.tgrid-event', el).forEach(e => setupGridDrag(e, el));
}
function layoutLanes(list) {
  const sorted = list.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const lanes = {}, groups = [];
  let cur = [], curEnd = -Infinity;
  sorted.forEach(o => {
    if (cur.length && o.start >= curEnd) { groups.push(cur); cur = []; curEnd = -Infinity; }
    cur.push(o); curEnd = Math.max(curEnd, o.end.getTime());
  });
  if (cur.length) groups.push(cur);
  groups.forEach(g => {
    const ends = [];
    g.forEach(o => {
      let placed = false;
      for (let i = 0; i < ends.length; i++) if (ends[i] <= o.start.getTime()) { lanes[o.key] = { i, n: 0 }; ends[i] = o.end.getTime(); placed = true; break; }
      if (!placed) { lanes[o.key] = { i: ends.length, n: 0 }; ends.push(o.end.getTime()); }
    });
    g.forEach(o => { lanes[o.key].n = ends.length; });
  });
  return lanes;
}
function setupGridDrag(el, root) {
  const id = el.getAttribute('data-id'), occ = el.getAttribute('data-occ');
  let mode = null, oTop = 0, oH = 0, startCol = null, curCol = null;
  makeDraggable(el, {
    onStart(ev) {
      State.ui.dragging = true;
      mode = (ev.target.getAttribute && ev.target.getAttribute('data-resize')) ? 'resize' : 'move';
      oTop = parseFloat(el.style.top) || 0; oH = parseFloat(el.style.height) || 30;
      const col = el.closest('.tgrid-col');
      startCol = col ? col.getAttribute('data-date') : null; curCol = startCol;
    },
    onMove(ev, dx, dy) {
      const gridH = (GRID_END - GRID_START) * 60;
      if (mode === 'resize') el.style.height = clamp(oH + dy, 20, gridH - oTop) + 'px';
      else {
        el.style.top = clamp(oTop + dy, 0, gridH - oH) + 'px';
        const u = document.elementFromPoint(ev.clientX, ev.clientY);
        const tc = u && u.closest ? u.closest('.tgrid-col') : null;
        if (tc && tc !== el.parentElement) { $$('.tgrid-col', root).forEach(c => c.classList.remove('drop-target')); tc.classList.add('drop-target'); tc.appendChild(el); curCol = tc.getAttribute('data-date'); }
      }
      const t = $('.tgrid-event-time', el);
      if (t) { const m = GRID_START * 60 + parseFloat(el.style.top) / PX_PER_MIN; t.textContent = minutesToTime(m) + '–' + minutesToTime(m + parseFloat(el.style.height) / PX_PER_MIN); }
    },
    onEnd() {
      State.ui.dragging = false;
      $$('.tgrid-col', root).forEach(c => c.classList.remove('drop-target'));
      const top = parseFloat(el.style.top) || 0, h = parseFloat(el.style.height) || 30;
      applyGridChange(id, occ, curCol || startCol, GRID_START * 60 + Math.round(top / PX_PER_MIN / SNAP) * SNAP, Math.max(SNAP * 2, Math.round(h / PX_PER_MIN / SNAP) * SNAP), mode === 'resize');
    },
    onTap() { openEventDetails(id, occ); }
  });
  el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); openEventDetails(id, occ); } });
}
async function applyGridChange(id, occKey, dkey, startMin, durMin, isResize) {
  const e = findEvent(id);
  if (!e || !dkey) return;
  const p = dkey.split('-').map(Number);
  const ns = new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0);
  ns.setMinutes(startMin);
  const isSeries = (e.repeat || 'none') !== 'none';
  if (isSeries) {
    if (dateKey(ns) !== occKey) { await detachOccurrence(e, occKey, dateKey(ns)); return; }
    const cur = occurrencesOf(e, startOfDay(ns), new Date(startOfDay(ns).getTime() + 86400000))[0];
    if (!cur) return;
    const ne = isResize ? new Date(ns.getTime() + durMin * 60000) : new Date(ns.getTime() + (cur.end - cur.start));
    if (ne.getTime() === cur.end.getTime() && cur.start.getTime() === ns.getTime()) { renderCalendarContent(); return; }
    await detachOccurrence(e, occKey, occKey);
    const ex = State.events.find(x => x.exceptionOf === id && dateKey(x.start) === occKey);
    if (ex) {
      ex.start = ns.toISOString();
      ex.end = (isResize ? new Date(ns.getTime() + durMin * 60000) : new Date(ns.getTime() + (cur.end - cur.start))).toISOString();
      await saveEvent(ex);
      Toast.success('Вхождение обновлено');
      renderCalendarContent();
    }
    return;
  }
  const oldS = new Date(e.start), oldE = new Date(e.end || e.start);
  const ne = isResize ? new Date(ns.getTime() + durMin * 60000) : new Date(ns.getTime() + (oldE - oldS));
  if (oldS.getTime() === ns.getTime() && ne.getTime() === oldE.getTime()) { renderCalendarContent(); return; }
  if (ne <= ns) ne.setTime(ns.getTime() + 15 * 60000);
  const copy = JSON.parse(JSON.stringify(e));
  e.start = ns.toISOString(); e.end = ne.toISOString();
  await saveEvent(e);
  await logActivity('event', 'Изменено время «' + e.title + '»: ' + formatTime(ns) + '–' + formatTime(ne), e.id);
  Toast.success('Время обновлено: ' + formatTime(ns) + '–' + formatTime(ne), { label: 'Отменить', fn: async () => { await saveEvent(copy); renderCalendarContent(); } });
  renderCalendarContent();
}
function renderDayView(el) {
  const d = startOfDay(State.ui.calendarDate), k = dateKey(d);
  const list = occurrencesOnDate(d);
  const isToday = k === dateKey(new Date());
  el.innerHTML = '<div class="card mb-4" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">' +
    '<div class="date-block" style="min-width:136px;padding:18px 14px">' +
      '<div class="date-block-weekday" style="font-size:14px">' + escapeHtml(d.toLocaleDateString('ru-RU', { weekday: 'long' })) + '</div>' +
      '<div class="date-block-day" style="font-size:62px">' + d.getDate() + '</div>' +
      '<div class="date-block-month" style="font-size:13px">' + escapeHtml(d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })) + '</div></div>' +
    '<div style="flex:1;min-width:180px"><div style="font-size:20px;font-weight:800;margin-bottom:6px">' + list.length + ' ' + plural(list.length, 'событие', 'события', 'событий') + (isToday ? ' · сегодня' : '') + '</div>' +
      '<div class="text-muted" style="font-size:13px;margin-bottom:12px">' + (list.length ? escapeHtml(list.map(o => formatTime(o.start) + ' ' + o.ev.title).join(' · ')) : 'Свободный день') + '</div>' +
      '<div class="flex gap-2 flex-wrap"><button class="btn btn-sm btn-primary" type="button" data-act="new-event-day" data-day="' + k + '">' + icon('plus', 15) + 'Событие</button>' +
      '<button class="btn btn-sm" type="button" data-act="cal-week-of-day" data-day="' + k + '">Неделя</button></div></div></div>' +
    (list.length ? list.map(o => occurrenceCardHTML(o, true)).join('') : emptyBlock('📅', 'Событий на этот день нет', 'Двойное нажатие по дню в режиме «Месяц» или «Неделя» создаёт событие в нужное время.', 'new-event-day', 'Добавить событие', k));
}
function renderAgenda(el) {
  const now = startOfDay(new Date());
  const list = expandOccurrences(new Date(now.getTime() - 86400000), new Date(now.getTime() + 86400000 * 120));
  if (!list.length) { el.innerHTML = '<div class="card">' + emptyBlock('📅', 'Нет событий', 'Создайте первое событие, чтобы начать планировать репетиции и выступления.', 'new-event', 'Создать событие') + '</div>'; return; }
  const groups = new Map();
  list.forEach(o => { const k = dateKey(o.start); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); });
  let html = '';
  Array.from(groups.keys()).sort().forEach(k => {
    const d = new Date(k + 'T12:00:00'), diff = daysBetween(now, d);
    let label = d.toLocaleDateString('ru-RU', { weekday: 'long' });
    if (diff === 0) label = 'Сегодня'; else if (diff === 1) label = 'Завтра'; else if (diff === -1) label = 'Вчера';
    html += '<div class="mb-4"><div class="section-title" style="font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)">' + escapeHtml(label) + ' · ' + escapeHtml(formatDate(d)) + '</div>' +
      groups.get(k).map(o => occurrenceCardHTML(o, false)).join('') + '</div>';
  });
  el.innerHTML = html;
}
function createEventAt(dkey, minutes) {
  const p = String(dkey).split('-').map(Number);
  const s = new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0);
  s.setMinutes(minutes == null ? 600 : minutes);
  openEventEditor({ start: s.toISOString(), end: new Date(s.getTime() + 7200000).toISOString(), groupId: State.ui.filters.groupId || '' });
}

/* ═══ SECTION 8: EVENTS ═══ */
const REMINDER_OPTIONS = [
  { v: 5, l: 'За 5 минут' }, { v: 10, l: 'За 10 минут' }, { v: 15, l: 'За 15 минут' }, { v: 30, l: 'За 30 минут' },
  { v: 60, l: 'За 1 час' }, { v: 180, l: 'За 3 часа' }, { v: 1440, l: 'За 1 день' }, { v: 10080, l: 'За 1 неделю' }
];
function reminderLabel(m) {
  if (m < 60) return 'за ' + m + ' мин';
  if (m < 1440) return 'за ' + (m / 60) + ' ' + plural(m / 60, 'час', 'часа', 'часов');
  if (m < 10080) return 'за ' + (m / 1440) + ' ' + plural(m / 1440, 'день', 'дня', 'дней');
  return 'за ' + (m / 10080) + ' ' + plural(m / 10080, 'неделю', 'недели', 'недель');
}
function openEventDetails(id, occKey) {
  const e = findEvent(id);
  if (!e) { Toast.error('Событие не найдено'); return; }
  const g = findGroup(e.groupId);
  const sl = e.setlistId ? findSetlist(e.setlistId) : null;
  const occ = occKey ? (occurrencesOf(e, startOfDay(occKey), new Date(startOfDay(occKey).getTime() + 86400000))[0]) : null;
  const s = occ ? occ.start : new Date(e.start), en = occ ? occ.end : new Date(e.end || e.start);
  const isSeries = (e.repeat || 'none') !== 'none';
  const body =
    '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:10px">' +
      '<div class="date-block" style="min-width:110px;padding:14px 10px"><div class="date-block-weekday">' + WD[s.getDay()] + '</div>' +
        '<div class="date-block-day" style="font-size:44px">' + s.getDate() + '</div>' +
        '<div class="date-block-month">' + escapeHtml(s.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })) + '</div></div>' +
      '<div style="flex:1;min-width:150px"><div style="font-size:18px;font-weight:800;margin-bottom:6px">' + formatTime(s) + ' — ' + formatTime(en) + '</div>' +
        '<div class="flex gap-2 flex-wrap"><span class="badge badge-accent">' + escapeHtml(EVENT_TYPES[e.type] || 'Событие') + '</span>' +
        (isSeries ? '<span class="badge badge-muted">' + icon('repeat', 12) + ' ' + REPEATS[e.repeat] + (e.repeatUntil ? ' до ' + escapeHtml(formatDateShort(e.repeatUntil)) : '') + '</span>' : '') +
        (occ && !occ.single ? '<span class="badge badge-muted">Вхождение серии</span>' : '') +
        '<span class="badge ' + (e.status === 'confirmed' ? 'badge-success' : 'badge-warning') + '">' + (e.status === 'confirmed' ? 'Подтверждено' : 'Ожидает') + '</span></div></div></div>' +
    '<div class="form-group mb-2"><span class="form-label">Моё участие</span><div class="part-switch">' +
      ['yes', 'maybe', 'no'].map(k => '<button class="part-btn' + (e.myStatus === k ? ' on' : '') + '" type="button" data-act="my-status" data-id="' + e.id + '" data-val="' + k + '" data-modal-keep="1">' + MY_STATUS[k] + '</button>').join('') + '</div></div>' +
    '<div class="info-row"><span class="info-label">Место</span><span class="info-value">' + escapeHtml(e.location || '—') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Группа</span><span class="info-value">' + (g ? escapeHtml(g.name) : '—') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Сет-лист</span><span class="info-value">' + (sl ? escapeHtml(sl.name) + ' · ' + (sl.items || []).length + ' ' + plural((sl.items || []).length, 'песня', 'песни', 'песен') : 'не назначен') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Напоминания</span><span class="info-value">' + escapeHtml((e.reminderOffsets || []).length ? e.reminderOffsets.map(reminderLabel).join(', ') : '—') + '</span></div>' +
    '<div class="info-row"><span class="info-label">Участники</span><span class="info-value">' + ((e.participants || []).length || '—') + '</span></div>' +
    ((e.participants || []).length ? '<div style="margin-top:8px">' + e.participants.map(p => {
      const m = findMember(p.memberId); if (!m) return '';
      const st = p.status || 'pending';
      const cls = st === 'confirmed' ? 'badge-success' : st === 'declined' ? 'badge-danger' : 'badge-warning';
      return '<div class="participant-row"><span class="p-name"><span class="p-dot" style="background:' + escapeHtml(m.color || 'var(--accent)') + '"></span>' + escapeHtml(m.name) +
        (m.roles && m.roles.length ? ' <small class="text-muted">· ' + escapeHtml(m.roles.join(', ')) + '</small>' : '') + '</span><span class="badge ' + cls + '">' + PARTICIPANT_STATUS[st] + '</span></div>';
    }).join('') + '</div>' : '') +
    (e.description ? '<div class="info-row" style="align-items:flex-start"><span class="info-label">Описание</span><span class="info-value" style="max-width:70%;font-weight:500">' + escapeHtml(e.description) + '</span></div>' : '') +
    ((e.fileIds || []).length ? '<div class="mt-2">' + fileListHTML(e.fileIds, 'event', e.id) + '</div>' : '');

  const footer =
    (isSeries && occ ? '<button class="btn" type="button" data-act="recur-edit-one" data-id="' + e.id + '" data-occ="' + dateKey(s) + '" data-modal-close>Только это</button>' : '') +
    (sl ? '<button class="btn" type="button" data-modal-close data-go="#/band/setlist/' + sl.id + '">Сет-лист</button>' : '') +
    '<button class="btn" type="button" data-act="scene-from-event" data-id="' + e.id + '" data-modal-close>' + icon('stage', 16) + 'Сцена</button>' +
    '<button class="btn" type="button" data-act="duplicate-event" data-id="' + e.id + '" data-modal-close>' + icon('copy', 16) + '</button>' +
    (isSeries && occ ? '<button class="btn btn-danger" type="button" data-act="recur-cancel-one" data-id="' + e.id + '" data-occ="' + dateKey(s) + '" data-modal-close>Отменить дату</button>' : '') +
    '<button class="btn btn-danger" type="button" data-act="delete-event" data-id="' + e.id + '" data-modal-close>' + icon('trash', 16) + '</button>' +
    '<button class="btn btn-primary" type="button" data-act="edit-event" data-id="' + e.id + '" data-modal-close>' + icon('edit', 16) + (isSeries ? 'Серия' : 'Изменить') + '</button>';
  Modal.show(e.title, body, footer, { size: 'modal-lg' });
}
async function setMyStatus(eventId, status) {
  const e = findEvent(eventId);
  if (!e) return;
  const prev = e.myStatus;
  e.myStatus = (prev === status) ? null : status;
  await saveEvent(e);
  await logActivity('event', 'Статус участия «' + (e.myStatus ? MY_STATUS[e.myStatus] : 'сброшен') + '» — ' + e.title, e.id);
  Toast.success(e.myStatus ? 'Отмечено: ' + MY_STATUS[e.myStatus] : 'Статус участия сброшен');
  rerenderCurrent();
}
function rerenderCurrent() { handleRoute(); }
function openEventEditor(prefill) {
  prefill = prefill || {};
  const e = prefill.id ? findEvent(prefill.id) : null;
  const isEdit = !!e;
  const draft = !isEdit ? readDraft(DRAFT_EVENT) : null;
  const start = e ? new Date(e.start) : (prefill.start ? new Date(prefill.start) : new Date());
  const end = e ? new Date(e.end || start) : (prefill.end ? new Date(prefill.end) : new Date(start.getTime() + 7200000));
  const pmap = {}; if (e) (e.participants || []).forEach(p => { pmap[p.memberId] = p; });
  const offsets = e ? (e.reminderOffsets || []) : (State.settings.reminderDefaults || []);
  const customOffsets = offsets.filter(o => !REMINDER_OPTIONS.some(r => r.v === o));
  const body =
    (draft ? '<div class="draft-banner"><span>📝</span><span>Найден черновик события от ' + escapeHtml(formatDateShort(draft.savedAt) + ' ' + formatTime(draft.savedAt)) + '</span>' +
      '<button class="btn btn-sm" type="button" id="evDraftRestore">Восстановить</button><button class="btn btn-sm" type="button" id="evDraftDrop">Удалить</button></div>' : '') +
    '<div class="form-group"><label class="form-label" for="evtTitle">Название *</label>' +
      '<input class="form-input" id="evtTitle" type="text" maxlength="120" placeholder="Например: Воскресное служение" value="' + (e ? escapeHtml(e.title) : '') + '"></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="evtType">Тип события</label><select class="form-select" id="evtType">' +
        Object.keys(EVENT_TYPES).map(t => '<option value="' + t + '"' + (((e && e.type === t) || (!e && t === (prefill.type || 'rehearsal'))) ? ' selected' : '') + '>' + EVENT_TYPES[t] + '</option>').join('') + '</select></div>' +
      '<div class="form-group"><label class="form-label" for="evtDate">Дата *</label><input class="form-input" id="evtDate" type="date" value="' + toLocalDateInput(start) + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="evtStart">Начало *</label><input class="form-input" id="evtStart" type="time" value="' + toLocalTimeInput(start) + '"></div>' +
      '<div class="form-group"><label class="form-label" for="evtEnd">Окончание</label><input class="form-input" id="evtEnd" type="time" value="' + toLocalTimeInput(end) + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="evtLocation">Место проведения</label><input class="form-input" id="evtLocation" type="text" placeholder="Зал, адрес" value="' + (e ? escapeHtml(e.location || '') : '') + '"></div>' +
      '<div class="form-group"><label class="form-label" for="evtGroup">Группа</label><select class="form-select" id="evtGroup"><option value="">—</option>' +
        State.groups.map(g => '<option value="' + g.id + '"' + (((e && e.groupId === g.id) || (!e && prefill.groupId === g.id)) ? ' selected' : '') + '>' + escapeHtml(g.name) + '</option>').join('') + '</select></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="evtSetlist">Сет-лист / песни</label><select class="form-select" id="evtSetlist"><option value="">—</option>' +
        State.setlists.map(s => '<option value="' + s.id + '"' + (e && e.setlistId === s.id ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>').join('') + '</select></div>' +
      '<div class="form-group"><label class="form-label" for="evtStatus">Статус</label><select class="form-select" id="evtStatus">' +
        '<option value="confirmed"' + (!e || e.status === 'confirmed' ? ' selected' : '') + '>Подтверждено</option>' +
        '<option value="pending"' + (e && e.status === 'pending' ? ' selected' : '') + '>Ожидает</option>' +
        '<option value="cancelled"' + (e && e.status === 'cancelled' ? ' selected' : '') + '>Отменено</option></select></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="evtRepeat">Повторение</label><select class="form-select" id="evtRepeat">' +
        Object.keys(REPEATS).map(k => '<option value="' + k + '"' + ((e && e.repeat === k) || (!e && k === 'none') ? ' selected' : '') + '>' + REPEATS[k] + '</option>').join('') + '</select></div>' +
      '<div class="form-group"><label class="form-label" for="evtRepeatUntil">Повторять до</label><input class="form-input" id="evtRepeatUntil" type="date" value="' + (e && e.repeatUntil ? toLocalDateInput(e.repeatUntil) : '') + '"></div>' +
    '</div>' +
    '<div class="form-group"><span class="form-label">Моё участие</span><div class="part-switch" id="evtMyStatus">' +
      ['yes', 'maybe', 'no'].map(k => '<button class="part-btn' + (((e && e.myStatus === k) || (!e && State.profile.defaultParticipation === k)) ? ' on' : '') + '" type="button" data-my="' + k + '">' + MY_STATUS[k] + '</button>').join('') + '</div></div>' +
    '<div class="form-group"><span class="form-label">Участники и статусы</span>' +
      (State.members.length ? '<div id="evtParticipants" style="max-height:230px;overflow-y:auto">' + State.members.map(m => {
        const p = pmap[m.id], st = p ? (p.status || 'pending') : 'pending';
        return '<div class="participant-row"><label class="p-name"><input type="checkbox" class="p-check" value="' + m.id + '"' + (p ? ' checked' : '') + ' style="accent-color:var(--accent);width:17px;height:17px">' +
          '<span class="p-dot" style="background:' + escapeHtml(m.color || 'var(--accent)') + '"></span>' + escapeHtml(m.name) + '</label>' +
          '<select class="form-select p-status" data-for="' + m.id + '"' + (p ? '' : ' disabled') + '>' +
          Object.keys(PARTICIPANT_STATUS).map(k => '<option value="' + k + '"' + (st === k ? ' selected' : '') + '>' + PARTICIPANT_STATUS[k] + '</option>').join('') + '</select></div>';
      }).join('') + '</div><button class="btn btn-sm mt-2" type="button" id="evtSelectGroup">Отметить состав группы</button>'
      : '<p class="form-hint">Добавьте участников во вкладке «Сет-листы и группы».</p>') + '</div>' +
    '<div class="form-group"><span class="form-label">Напоминания</span><div class="chip-row" id="evtReminders">' +
      REMINDER_OPTIONS.map(o => '<label class="chip' + (offsets.indexOf(o.v) >= 0 ? ' active' : '') + '"><input type="checkbox" value="' + o.v + '"' + (offsets.indexOf(o.v) >= 0 ? ' checked' : '') + '>' + o.l + '</label>').join('') + '</div>' +
      '<div class="form-row mt-2"><div class="form-group"><label class="form-label" for="evtCustomRem">Своё напоминание (минут)</label>' +
      '<input class="form-input" id="evtCustomRem" type="number" min="1" max="525600" inputmode="numeric" placeholder="Например: 45"></div>' +
      '<div class="form-group" style="justify-content:flex-end"><label class="form-label">&nbsp;</label><button class="btn btn-sm" type="button" id="evtAddCustomRem">Добавить</button></div></div>' +
      '<div class="chip-row mt-2" id="evtCustomRems">' + customOffsets.map(o => '<label class="chip active"><input type="checkbox" value="' + o + '" checked>' + reminderLabel(o) + '</label>').join('') + '</div></div>' +
    '<div class="form-group"><label class="form-label" for="evtDesc">Описание</label>' +
      '<textarea class="form-textarea" id="evtDesc" style="min-height:70px;font-family:var(--font);font-size:14px" placeholder="Программа, заметки, контакты площадки">' + (e ? escapeHtml(e.description || '') : '') + '</textarea></div>' +
    '<div class="form-group"><span class="form-label">Цветовая метка</span><div class="chip-row" id="evtColors">' +
      Object.keys(TYPE_COLORS).concat(['#6366f1', '#0ea5e9', '#64748b']).map((c, i) => {
        const val = TYPE_COLORS[c] || c;
        const cur = e ? (e.color || TYPE_COLORS[e.type]) : TYPE_COLORS[prefill.type || 'rehearsal'];
        return '<button class="accent-swatch' + (cur === val ? ' on' : '') + '" type="button" data-color="' + val + '" style="background:' + val + '" aria-label="Цвет ' + (i + 1) + '"></button>';
      }).join('') + '</div></div>' +
    (isEdit ? fileListHTML(e.fileIds, 'event', e.id) : '<p class="form-hint">Вложенные файлы можно добавить после создания события.</p>') +
    '<div class="form-error" id="evtError" role="alert" hidden></div>';

  Modal.show(isEdit ? ((e.repeat && e.repeat !== 'none') ? 'Редактировать серию событий' : 'Редактировать событие') : 'Новое событие', body,
    (isEdit ? '<button class="btn btn-danger" type="button" data-act="delete-event" data-id="' + e.id + '" data-modal-close>' + icon('trash', 16) + '</button>' : '') +
    '<span class="autosave-note" id="evtAutosave">Черновик сохраняется автоматически</span>' +
    '<button class="btn" type="button" data-modal-close>Отмена</button>' +
    '<button class="btn btn-primary" type="button" id="saveEventBtn">' + (isEdit ? 'Сохранить' : 'Создать') + '</button>',
    { size: 'modal-lg', onMount: mountEventEditor });

  let chosenColor = e ? (e.color || TYPE_COLORS[e.type]) : TYPE_COLORS[prefill.type || 'rehearsal'];
  let myStatus = e ? e.myStatus : (State.profile.defaultParticipation || 'yes');
  function mountEventEditor() {
    $$('#evtParticipants .p-check').forEach(cb => cb.addEventListener('change', () => {
      const sel = $('#evtParticipants .p-status[data-for="' + cb.value + '"]'); if (sel) sel.disabled = !cb.checked;
    }, { passive: true }));
    const sg = $('#evtSelectGroup');
    if (sg) sg.addEventListener('click', () => {
      const gid = $('#evtGroup').value;
      const ids = gid ? State.members.filter(m => (m.groupIds || []).indexOf(gid) >= 0).map(m => m.id) : State.members.map(m => m.id);
      $$('#evtParticipants .p-check').forEach(cb => { cb.checked = ids.indexOf(cb.value) >= 0; const s = $('#evtParticipants .p-status[data-for="' + cb.value + '"]'); if (s) s.disabled = !cb.checked; });
    });
    $$('#evtReminders input').forEach(cb => cb.addEventListener('change', () => cb.closest('.chip').classList.toggle('active', cb.checked), { passive: true }));
    $$('#evtCustomRems input').forEach(cb => cb.addEventListener('change', () => cb.closest('.chip').classList.toggle('active', cb.checked), { passive: true }));
    const addRem = $('#evtAddCustomRem');
    if (addRem) addRem.addEventListener('click', () => {
      const inp = $('#evtCustomRem'), v = parseInt(inp.value, 10);
      if (!v || v < 1) { inp.classList.add('error'); return; }
      inp.classList.remove('error');
      if (REMINDER_OPTIONS.some(r => r.v === v) || $$('#evtCustomRems input').some(x => parseInt(x.value, 10) === v)) { Toast.info('Такое напоминание уже есть'); return; }
      $('#evtCustomRems').insertAdjacentHTML('beforeend', '<label class="chip active"><input type="checkbox" value="' + v + '" checked>' + reminderLabel(v) + '</label>');
      const cb = $('#evtCustomRems input[value="' + v + '"]');
      cb.addEventListener('change', () => cb.closest('.chip').classList.toggle('active', cb.checked), { passive: true });
      inp.value = '';
    });
    $$('#evtMyStatus .part-btn').forEach(b => b.addEventListener('click', () => {
      myStatus = b.getAttribute('data-my');
      $$('#evtMyStatus .part-btn').forEach(x => x.classList.toggle('on', x === b));
    }));
    $$('#evtColors .accent-swatch').forEach(b => b.addEventListener('click', () => {
      chosenColor = b.getAttribute('data-color');
      $$('#evtColors .accent-swatch').forEach(x => x.classList.toggle('on', x === b));
    }));
    $('#evtType').addEventListener('change', ev => {
      const def = { worship: 'Главный зал', rehearsal: 'Репетиционная база', meeting: 'Офис', concert: '', participation: '', personal: '' }[ev.target.value];
      const loc = $('#evtLocation'); if (def && !loc.value) loc.value = def;
    }, { passive: true });
    const saveDraftFn = debounce(() => {
      if (isEdit) return;
      const t = $('#evtTitle').value.trim();
      if (!t) { writeDraft(DRAFT_EVENT, null); return; }
      writeDraft(DRAFT_EVENT, { title: t, type: $('#evtType').value, date: $('#evtDate').value, start: $('#evtStart').value, end: $('#evtEnd').value, location: $('#evtLocation').value, groupId: $('#evtGroup').value, description: $('#evtDesc').value, savedAt: nowISO() });
      const n = $('#evtAutosave'); if (n) n.textContent = 'Черновик сохранён в ' + formatTime(new Date());
    }, 800);
    ['evtTitle', 'evtDate', 'evtStart', 'evtEnd', 'evtLocation', 'evtDesc'].forEach(idf => { const x = $('#' + idf); if (x) x.addEventListener('input', saveDraftFn, { passive: true }); });
    ['evtType', 'evtGroup'].forEach(idf => { const x = $('#' + idf); if (x) x.addEventListener('change', saveDraftFn, { passive: true }); });
    const dr = $('#evDraftRestore');
    if (dr) dr.addEventListener('click', () => {
      const d = readDraft(DRAFT_EVENT); if (!d) return;
      $('#evtTitle').value = d.title || ''; $('#evtType').value = d.type || 'rehearsal'; $('#evtDate').value = d.date || toLocalDateInput(new Date());
      $('#evtStart').value = d.start || '18:00'; $('#evtEnd').value = d.end || '20:00'; $('#evtLocation').value = d.location || '';
      $('#evtGroup').value = d.groupId || ''; $('#evtDesc').value = d.description || '';
      Toast.success('Черновик восстановлен');
    });
    const dd = $('#evDraftDrop');
    if (dd) dd.addEventListener('click', () => { writeDraft(DRAFT_EVENT, null); const b = $('.draft-banner'); if (b) b.remove(); Toast.info('Черновик удалён'); });
    $('#saveEventBtn').addEventListener('click', saveHandler);
  }
  async function saveHandler(ev) {
    const btn = ev.currentTarget;
    btn.classList.add('loading');
    const fail = (msg, fid) => {
      btn.classList.remove('loading');
      const er = $('#evtError'); er.textContent = msg; er.hidden = false;
      $$('.form-input.error, .form-select.error').forEach(x => x.classList.remove('error'));
      const f = $('#' + fid); if (f) { f.classList.add('error'); f.focus(); }
    };
    const title = $('#evtTitle').value.trim();
    if (!title) return fail('Введите название события', 'evtTitle');
    const dstr = $('#evtDate').value; if (!dstr) return fail('Укажите дату', 'evtDate');
    const sstr = $('#evtStart').value; if (!sstr) return fail('Укажите время начала', 'evtStart');
    const s = combineDateTime(dstr, sstr);
    if (isNaN(s.getTime())) return fail('Некорректная дата начала', 'evtDate');
    let en = combineDateTime(dstr, $('#evtEnd').value || sstr);
    if (en <= s) en = new Date(s.getTime() + 3600000);
    const repeat = $('#evtRepeat').value;
    const repeatUntil = $('#evtRepeatUntil').value ? ($('#evtRepeatUntil').value + 'T23:59:00') : null;
    if (repeat !== 'none' && repeatUntil && new Date(repeatUntil) < s) return fail('Дата окончания повтора раньше начала события', 'evtRepeatUntil');
    const participants = $$('#evtParticipants .p-check:checked').map(cb => {
      const sel = $('#evtParticipants .p-status[data-for="' + cb.value + '"]');
      return { memberId: cb.value, roleId: null, status: sel ? sel.value : 'pending', notes: '' };
    });
    const offsets = $$('#evtReminders input:checked').map(c => parseInt(c.value, 10))
      .concat($$('#evtCustomRems input:checked').map(c => parseInt(c.value, 10)));
    const evt = e ? Object.assign({}, e) : { id: uid('evt'), createdAt: nowISO(), exdates: [], fileIds: [] };
    evt.title = title; evt.type = $('#evtType').value;
    evt.start = s.toISOString(); evt.end = en.toISOString();
    evt.timezone = (Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
    evt.location = $('#evtLocation').value.trim();
    evt.groupId = $('#evtGroup').value || null;
    evt.setlistId = $('#evtSetlist').value || null;
    evt.status = $('#evtStatus').value;
    evt.description = $('#evtDesc').value.trim();
    evt.repeat = repeat; evt.repeatUntil = repeatUntil; evt.repeatInterval = 1;
    evt.myStatus = myStatus;
    evt.color = chosenColor || TYPE_COLORS[evt.type] || State.settings.accent;
    evt.participants = participants;
    evt.participantIds = participants.map(p => p.memberId);
    evt.reminderOffsets = Array.from(new Set(offsets)).sort((a, b) => a - b);
    await saveEvent(evt);
    await logActivity('event', (isEdit ? 'Обновлено событие «' : 'Создано событие «') + evt.title + '»', evt.id);
    if (!isEdit) writeDraft(DRAFT_EVENT, null);
    Modal.close();
    Toast.success(isEdit ? 'Событие сохранено' : (repeat !== 'none' ? 'Создано повторяющееся событие' : 'Событие создано'));
    rerenderCurrent();
  }
}
async function duplicateEvent(id) {
  const e = findEvent(id); if (!e) return;
  const c = JSON.parse(JSON.stringify(e));
  c.id = uid('evt'); c.title = e.title + ' (копия)'; c.exdates = []; c.createdAt = nowISO(); c.updatedAt = nowISO();
  await saveEvent(c);
  await logActivity('event', 'Дублировано событие «' + e.title + '»', c.id);
  Toast.success('Копия создана', { label: 'Открыть', fn: () => openEventDetails(c.id) });
  rerenderCurrent();
}
function confirmDeleteEvent(id) {
  const e = findEvent(id); if (!e) return;
  const isSeries = (e.repeat || 'none') !== 'none';
  Modal.confirm(isSeries ? 'Удалить серию событий?' : 'Удалить событие?',
    (isSeries ? '«' + e.title + '» повторяется. Будут удалены все вхождения серии и напоминания.' : '«' + e.title + '» (' + formatDate(e.start) + ') будет удалено вместе с напоминаниями.'),
    async () => {
      const copy = JSON.parse(JSON.stringify(e));
      const exceptions = State.events.filter(x => x.exceptionOf === id).map(x => JSON.parse(JSON.stringify(x)));
      await deleteEvent(id);
      await logActivity('event', 'Удалено событие «' + e.title + '»', id);
      Toast.success('Удалено', {
        label: 'Вернуть', fn: async () => { await saveEvent(copy); for (const x of exceptions) await saveEvent(x); rerenderCurrent(); }
      });
      rerenderCurrent();
    }, 'Удалить', true);
}
async function editOneOccurrence(id, occKey) {
  const e = findEvent(id); if (!e) return;
  const occ = occurrencesOf(e, startOfDay(occKey), new Date(startOfDay(occKey).getTime() + 86400000))[0];
  if (!occ) { Toast.error('Вхождение не найдено'); return; }
  await detachOccurrence(e, occKey, occKey);
  const ex = State.events.find(x => x.exceptionOf === id && dateKey(x.start) === occKey);
  if (ex) openEventEditor({ id: ex.id });
}
async function cancelOneOccurrence(id, occKey) {
  const e = findEvent(id); if (!e) return;
  const prev = JSON.parse(JSON.stringify(e));
  e.exdates = (e.exdates || []).concat([occKey]);
  await saveEvent(e);
  await logActivity('event', 'Отменено вхождение «' + e.title + '» на ' + formatDate(occKey), e.id);
  Toast.success('Вхождение отменено', { label: 'Вернуть', fn: async () => { await saveEvent(prev); rerenderCurrent(); } });
  rerenderCurrent();
}
/* — Reminders scheduler — */
async function syncReminders(e) {
  for (const r of State.reminders.filter(x => x.eventId === e.id)) await dbDelete('reminders', r.id);
  State.reminders = State.reminders.filter(x => x.eventId !== e.id);
  if (e.status === 'cancelled') return;
  const occurrences = (e.repeat && e.repeat !== 'none')
    ? occurrencesOf(e, new Date(Date.now() - 3600000), new Date(Date.now() + 86400000 * 60))
    : [{ start: new Date(e.start) }];
  for (const o of occurrences.slice(0, 20)) {
    for (const off of (e.reminderOffsets || [])) {
      const rem = { id: uid('rem'), eventId: e.id, offsetMin: off, occKey: dateKey(o.start), fireAt: new Date(o.start.getTime() - off * 60000).toISOString(), fired: false, createdAt: nowISO() };
      State.reminders.push(rem);
      await dbPut('reminders', rem);
    }
  }
}
async function refreshAllReminders() { for (const e of State.events) await syncReminders(e); }
function startReminderScheduler() { checkReminders(); setInterval(checkReminders, 20000); }
async function checkReminders() {
  if (!State.settings.notifications) return;
  const now = Date.now();
  for (const r of State.reminders.slice()) {
    if (r.fired) continue;
    const e = findEvent(r.eventId);
    if (!e) { await dbDelete('reminders', r.id); State.reminders = State.reminders.filter(x => x.id !== r.id); continue; }
    const t = new Date(r.fireAt).getTime();
    const occ = r.occKey ? new Date(r.occKey + 'T00:00:00') : new Date(e.start);
    if (t <= now && occ.getTime() > now - 3600000) {
      r.fired = true; await dbPut('reminders', r);
      notifyUser('Напоминание: ' + e.title, formatDateShort(occ) + ' в ' + formatTime(e.start) + (e.location ? ' · ' + e.location : ''), () => openEventDetails(e.id, r.occKey));
    } else if (occ.getTime() < now - 3600000) { r.fired = true; await dbPut('reminders', r); }
  }
}
function notifyUser(title, body, onClick) {
  Toast.show(title + ' — ' + body, 'info', onClick ? { label: 'Открыть', fn: onClick } : null, 9000);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(title, { body, tag: title + body }); if (onClick) n.onclick = () => { window.focus(); onClick(); }; } catch (e) { Logger.warn('notification', e); }
  }
}
async function requestNotifications() {
  if (!('Notification' in window)) { Toast.warning('Уведомления не поддерживаются этим браузером'); return; }
  try {
    const res = await Notification.requestPermission();
    persistSetting('notifications', res === 'granted');
    if (res === 'granted') { Toast.success('Уведомления включены'); await refreshAllReminders(); }
    else Toast.warning('Разрешение на уведомления не выдано');
    if (State.ui.base === '/more') renderMore();
  } catch (e) { Toast.error('Не удалось запросить разрешение'); }
}

/* ═══ SECTION 9: SONGS ═══ */
const GENRES = ['Worship', 'Hymn', 'Rock', 'Pop', 'Ballad', 'Jazz', 'Folk', 'Electronic', 'Gospel', 'Other'];
const TIME_SIGNATURES = ['4/4', '3/4', '6/8', '2/4', '5/4', '7/8', '12/8'];
function renderSongs() {
  const st = State.ui.songs;
  $('#content').innerHTML =
    '<div class="page-header"><div><h1 class="page-title">Песни</h1>' +
      '<p class="page-subtitle" id="songsSubtitle">' + State.songs.length + ' ' + plural(State.songs.length, 'песня', 'песни', 'песен') + ' в каталоге</p></div>' +
      '<div class="page-actions">' +
        '<button class="btn" type="button" data-act="toggle-select-mode">' + icon('check', 18) + 'Выбрать</button>' +
        '<button class="btn" type="button" data-act="export-songs">' + icon('download', 18) + 'Экспорт</button>' +
        '<button class="btn btn-primary" type="button" data-act="new-song">' + icon('plus', 18) + 'Песня</button>' +
      '</div></div>' +
    '<div class="tabs" id="songFilterTabs" role="tablist">' +
      [['all', 'Все'], ['favorite', '★ Избранные'], ['recent', 'Недавние'], ['az', 'А–Я']].map(f =>
        '<button class="tab' + (st.filter === f[0] ? ' active' : '') + '" role="tab" aria-selected="' + (st.filter === f[0]) + '" type="button" data-act="song-filter" data-val="' + f[0] + '">' + f[1] + '</button>').join('') +
    '</div>' +
    '<div class="calendar-filters">' +
      '<div class="filter-search">' + icon('search', 16) + '<input type="search" id="songSearch" placeholder="Поиск: название, исполнитель, автор, текст, тег, тональность…" value="' + escapeHtml(st.query) + '" aria-label="Поиск песен"></div>' +
      '<select class="form-select" id="songSort" aria-label="Сортировка">' +
        [['updated', 'Сначала изменённые'], ['created', 'Сначала новые'], ['title', 'По названию'], ['artist', 'По исполнителю'], ['key', 'По тональности'], ['bpm', 'По темпу']].map(o =>
          '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
      '<select class="form-select" id="songGroupFilter" aria-label="Группа"><option value="">Все группы</option>' +
        State.groups.map(g => '<option value="' + g.id + '"' + (st.group === g.id ? ' selected' : '') + '>' + escapeHtml(g.name) + '</option>').join('') + '</select>' +
      '<select class="form-select" id="songGenreFilter" aria-label="Жанр"><option value="">Все жанры</option>' +
        Array.from(new Set(GENRES.concat(State.songs.map(s => s.genre).filter(Boolean)))).map(g => '<option value="' + escapeHtml(g) + '"' + (st.genre === g ? ' selected' : '') + '>' + escapeHtml(g) + '</option>').join('') + '</select>' +
      '<select class="form-select" id="songKeyFilter" aria-label="Тональность"><option value="">Все тональности</option>' +
        Array.from(new Set(State.songs.map(s => s.key).filter(Boolean))).sort().map(k => '<option value="' + escapeHtml(k) + '"' + (st.key === k ? ' selected' : '') + '>' + escapeHtml(k) + '</option>').join('') + '</select>' +
      '<select class="form-select" id="songLangFilter" aria-label="Язык"><option value="">Все языки</option>' +
        Array.from(new Set(State.songs.map(s => s.language).filter(Boolean))).sort().map(l => '<option value="' + escapeHtml(l) + '"' + (st.language === l ? ' selected' : '') + '>' + escapeHtml(l) + '</option>').join('') + '</select>' +
      '<button class="btn btn-sm" type="button" data-act="reset-song-filters">Сбросить</button>' +
    '</div>' +
    '<div id="selectionBar"></div>' +
    '<div id="songList" class="grid grid-2"></div>';
  const inp = $('#songSearch');
  inp.addEventListener('input', debounce(() => { st.query = inp.value; renderSongList(); }, 170), { passive: true });
  ['songSort', 'songGroupFilter', 'songGenreFilter', 'songKeyFilter', 'songLangFilter'].forEach(idf => {
    const elx = $('#' + idf);
    if (elx) elx.addEventListener('change', () => {
      st.sort = $('#songSort').value; st.group = $('#songGroupFilter').value;
      st.genre = $('#songGenreFilter').value; st.key = $('#songKeyFilter').value; st.language = $('#songLangFilter').value;
      renderSongList();
    }, { passive: true });
  });
  renderSongList();
}
function filteredSongs() {
  const st = State.ui.songs;
  let list = State.songs.slice();
  if (st.filter === 'favorite' || st.favOnly) list = list.filter(s => s.favorite);
  if (st.group) list = list.filter(s => (s.groupIds || []).indexOf(st.group) >= 0);
  if (st.genre) list = list.filter(s => s.genre === st.genre);
  if (st.key) list = list.filter(s => s.key === st.key);
  if (st.language) list = list.filter(s => s.language === st.language);
  const q = (st.query || '').toLowerCase().trim();
  if (q) list = list.filter(s =>
    (s.title || '').toLowerCase().indexOf(q) >= 0 || (s.artist || '').toLowerCase().indexOf(q) >= 0 ||
    (s.author || '').toLowerCase().indexOf(q) >= 0 || (s.key || '').toLowerCase().indexOf(q) >= 0 ||
    (s.genre || '').toLowerCase().indexOf(q) >= 0 || (s.tags || []).some(t => String(t).toLowerCase().indexOf(q) >= 0) ||
    (s.lyrics || '').toLowerCase().indexOf(q) >= 0);
  const cmp = {
    updated: (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
    created: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    title: (a, b) => (a.title || '').localeCompare(b.title || '', 'ru'),
    artist: (a, b) => (a.artist || a.author || '').localeCompare(b.artist || b.author || '', 'ru'),
    key: (a, b) => (a.key || 'zz').localeCompare(b.key || 'zz'),
    bpm: (a, b) => (b.bpm || 0) - (a.bpm || 0)
  }[st.sort] || ((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  list.sort(cmp);
  return list;
}
function renderSongList() {
  const el = $('#songList'); if (!el) return;
  const list = filteredSongs();
  const sub = $('#songsSubtitle');
  if (sub) sub.textContent = list.length + ' ' + plural(list.length, 'песня', 'песни', 'песен') + (State.ui.songs.query ? ' по запросу «' + State.ui.songs.query + '»' : '');
  if (!list.length) {
    el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🎵</div>' +
      '<div class="empty-state-title">' + (State.songs.length ? 'Ничего не найдено' : 'В каталоге пока нет песен') + '</div>' +
      '<div class="empty-state-text">' + (State.songs.length ? 'Измените запрос или сбросьте фильтры.' : 'Добавьте первую песню: текст, аккорды, тональность, темп, жанр, теги и файлы.') + '</div>' +
      '<button class="btn btn-primary" data-act="' + (State.songs.length ? 'reset-song-filters' : 'new-song') + '">' + (State.songs.length ? 'Сбросить фильтры' : icon('plus', 18) + 'Добавить первую песню') + '</button></div>';
    return;
  }
  renderChunked(el, list, songCardHTML, 24);
}
function songCardHTML(s) {
  const chords = extractChords(s.lyrics);
  const sel = State.ui.selection.has(s.id);
  return '<article class="song-card' + (sel ? ' selected' : '') + '" data-song="' + s.id + '" role="link" tabindex="0">' +
    (State.ui.selectMode ? '<span class="select-check" aria-hidden="true">' + (sel ? '✓' : '') + '</span>' : '') +
    '<button class="song-fav' + (s.favorite ? ' active' : '') + '" type="button" data-act="fav-song" data-id="' + s.id + '" aria-label="' + (s.favorite ? 'Убрать из избранного' : 'В избранное') + '">' + (s.favorite ? '★' : '☆') + '</button>' +
    '<div class="song-card-title">' + escapeHtml(s.title) + '</div>' +
    '<div class="song-card-meta">' +
      (s.key ? '<span>🔑 ' + escapeHtml(s.key) + '</span>' : '') +
      (s.bpm ? '<span>🥁 ' + s.bpm + '</span>' : '') +
      (s.timeSignature ? '<span>𝄴 ' + escapeHtml(s.timeSignature) + '</span>' : '') +
      (s.duration ? '<span>' + icon('clock', 13) + ' ' + durationLabel(s.duration) + '</span>' : '') +
      ((s.artist || s.author) ? '<span>✍️ ' + escapeHtml(s.artist || s.author) + '</span>' : '') +
      ((s.fileIds || []).length ? '<span>' + icon('paperclip', 13) + ' ' + s.fileIds.length + '</span>' : '') +
    '</div>' +
    '<div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">' +
      '<span class="song-badge">' + chords.length + ' ' + plural(chords.length, 'аккорд', 'аккорда', 'аккордов') + '</span>' +
      (s.genre ? '<span class="song-badge" style="background:var(--surface-3);color:var(--text-muted)">' + escapeHtml(s.genre) + '</span>' : '') +
      (s.tags || []).slice(0, 3).map(t => '<span class="song-badge" style="background:var(--surface-3);color:var(--text-muted)">' + escapeHtml(t) + '</span>').join('') +
    '</div></article>';
}
function renderSelectionBar() {
  const el = $('#selectionBar'); if (!el) return;
  const n = State.ui.selection.size;
  if (!State.ui.selectMode) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="selection-bar"><span class="selection-count">Выбрано: ' + n + '</span>' +
    '<button class="btn btn-sm" type="button" data-act="select-all">Все</button>' +
    '<button class="btn btn-sm" type="button" data-act="bulk-print"' + (n ? '' : ' disabled') + '>' + icon('print', 15) + 'Печать / PDF</button>' +
    '<button class="btn btn-sm" type="button" data-act="bulk-export"' + (n ? '' : ' disabled') + '>' + icon('download', 15) + 'Экспорт</button>' +
    '<button class="btn btn-sm" type="button" data-act="bulk-setlist"' + (n ? '' : ' disabled') + '>' + icon('list', 15) + 'В сет-лист</button>' +
    '<button class="btn btn-sm" type="button" data-act="bulk-group"' + (n ? '' : ' disabled') + '>' + icon('users', 15) + 'К группе</button>' +
    '<button class="btn btn-sm" type="button" data-act="bulk-fav"' + (n ? '' : ' disabled') + '>★ Избранное</button>' +
    '<button class="btn btn-sm btn-danger" type="button" data-act="bulk-delete"' + (n ? '' : ' disabled') + '>' + icon('trash', 15) + '</button>' +
    '<button class="btn btn-sm" type="button" data-act="toggle-select-mode">Закрыть</button></div>';
}
function renderSongDetail(songId) {
  const song = findSong(songId);
  if (!song) { Toast.error('Песня не найдена'); navigate('#/songs'); return; }
  const t = State.ui.transpose;
  const displayKey = song.key ? transposeKey(song.key, t) : '—';
  const chords = extractChords(song.lyrics);
  const versions = State.songVersions.filter(v => v.songId === song.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const usedIn = State.setlists.filter(sl => (sl.items || []).some(i => i.songId === song.id));
  const groups = (song.groupIds || []).map(findGroup).filter(Boolean);
  $('#content').innerHTML =
    '<div class="page-header"><div>' +
      '<button class="btn btn-sm mb-2" data-go="#/songs">' + icon('arrowLeft', 16) + 'К каталогу</button>' +
      '<h1 class="page-title">' + escapeHtml(song.title) + '</h1>' +
      '<p class="page-subtitle">' + escapeHtml([song.artist || song.author, 'Тональность: ' + displayKey, song.bpm ? song.bpm + ' BPM' : null, song.timeSignature, song.duration ? durationLabel(song.duration) : null].filter(Boolean).join(' · ')) + '</p>' +
    '</div><div class="page-actions">' +
      '<button class="btn' + (song.favorite ? ' btn-primary' : '') + '" type="button" data-act="fav-song" data-id="' + song.id + '" aria-label="Избранное">' + (song.favorite ? '★' : '☆') + '</button>' +
      '<button class="btn" type="button" data-act="song-to-setlist" data-id="' + song.id + '">' + icon('list', 16) + 'В сет-лист</button>' +
      '<button class="btn" type="button" data-act="print-preview-song" data-id="' + song.id + '">' + icon('print', 16) + 'Печать</button>' +
      '<button class="btn" type="button" data-act="export-song" data-id="' + song.id + '">' + icon('download', 16) + '</button>' +
      '<button class="btn" type="button" data-act="duplicate-song" data-id="' + song.id + '">' + icon('copy', 16) + '</button>' +
      '<button class="btn btn-primary" type="button" data-act="edit-song" data-id="' + song.id + '">' + icon('edit', 16) + 'Изменить</button>' +
    '</div></div>' +
    '<div class="card mb-4"><div class="flex items-center justify-between flex-wrap gap-2">' +
      '<div><h2 class="section-title" style="margin:0">Транспонирование</h2>' +
      '<div class="text-muted" style="font-size:13px;margin-top:4px">Оригинал: <strong>' + escapeHtml(song.key || '—') + '</strong> → сейчас: <strong>' + escapeHtml(displayKey) + '</strong></div></div>' +
      '<div class="transpose-controls">' +
        '<button class="transpose-btn" type="button" data-act="transpose" data-d="-1" aria-label="Ниже">−</button>' +
        '<span class="transpose-value" aria-live="polite">' + (t > 0 ? '+' : '') + t + '</span>' +
        '<button class="transpose-btn" type="button" data-act="transpose" data-d="1" aria-label="Выше">+</button>' +
        '<button class="transpose-btn" type="button" data-act="transpose-reset" aria-label="Сбросить">↺</button></div></div>' +
      '<div class="flex gap-2 flex-wrap mt-4">' +
        '<button class="btn btn-sm btn-primary" type="button" data-act="scene-from-song" data-id="' + song.id + '">' + icon('stage', 16) + 'На сцену</button>' +
        '<button class="btn btn-sm" type="button" data-act="scene-from-song-auto" data-id="' + song.id + '">▶ Автопрокрутка</button></div></div>' +
    '<section class="card mb-4"><h2 class="section-title">Текст и аккорды</h2>' + renderLyrics(song.lyrics, t) + '</section>' +
    (chords.length ? '<section class="card mb-4"><h2 class="section-title">Используемые аккорды</h2><div class="chip-row">' + chords.map(c => '<span class="song-badge" style="font-size:13px;padding:6px 12px">' + escapeHtml(transposeChord(c, t)) + '</span>').join('') + '</div></section>' : '') +
    '<section class="card mb-4"><h2 class="section-title">Карточка песни</h2>' +
      infoRow('Исполнитель / автор', song.artist || song.author || '—') +
      infoRow('Тональность', song.key || '—') + infoRow('Темп', song.bpm ? song.bpm + ' BPM' : '—') +
      infoRow('Размер', song.timeSignature || '—') + infoRow('Жанр', song.genre || '—') +
      infoRow('Язык', song.language || '—') + infoRow('Длительность', durationLabel(song.duration)) +
      infoRow('Теги', (song.tags || []).length ? song.tags.map(x => '<span class="song-badge">' + escapeHtml(x) + '</span>').join(' ') : '—') +
      infoRow('Группы', groups.length ? groups.map(g => '<a href="#/band/group/' + g.id + '" style="color:var(--accent)">' + escapeHtml(g.name) + '</a>').join(', ') : '—') +
      infoRow('Используется в сет-листах', usedIn.length ? usedIn.map(sl => '<a href="#/band/setlist/' + sl.id + '" style="color:var(--accent)">' + escapeHtml(sl.name) + '</a>').join(', ') : '—') +
      infoRow('Создана', formatDate(song.createdAt) + ' ' + formatTime(song.createdAt)) +
      infoRow('Изменена', formatDate(song.updatedAt) + ' ' + formatTime(song.updatedAt)) +
      (song.link ? '<div class="info-row"><span class="info-label">Ссылка на оригинал / демо</span><span class="info-value"><a href="' + escapeHtml(song.link) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent);display:inline-flex;align-items:center;gap:6px">' + icon('link', 14) + 'Открыть</a></span></div>' : '') +
      (song.notes ? '<div class="info-row" style="align-items:flex-start"><span class="info-label">Заметки для музыкантов</span><span class="info-value" style="max-width:70%;font-weight:500">' + escapeHtml(song.notes) + '</span></div>' : '') +
    '</section>' +
    '<section class="card mb-4">' + fileListHTML(song.fileIds, 'song', song.id) + '</section>' +
    '<section class="card mb-4"><div class="flex items-center justify-between flex-wrap gap-2 mb-2">' +
      '<h2 class="section-title" style="margin:0">Версии песни (' + versions.length + ')</h2>' +
      '<button class="btn btn-sm" type="button" data-act="save-version" data-id="' + song.id + '">' + icon('copy', 16) + 'Зафиксировать версию</button></div>' +
      (versions.length ? versions.slice(0, 12).map((v, i) => '<div class="version-item"><div class="version-info">' +
        '<div class="version-title">Версия ' + (v.versionNumber || (versions.length - i)) + (i === 0 ? ' <span class="badge badge-muted">предыдущая</span>' : '') + '</div>' +
        '<div class="version-meta">' + escapeHtml(formatDate(v.createdAt) + ' ' + formatTime(v.createdAt)) + ' · ' + escapeHtml(v.data.key || '—') + (v.data.bpm ? ' · ' + v.data.bpm + ' BPM' : '') + '</div></div>' +
        '<button class="btn btn-sm" type="button" data-act="restore-version" data-id="' + v.id + '">' + icon('refresh', 16) + 'Восстановить</button>' +
        '<button class="btn btn-sm btn-danger" type="button" data-act="delete-version" data-id="' + v.id + '" aria-label="Удалить версию">' + icon('trash', 16) + '</button></div>').join('')
        : '<p class="text-muted" style="font-size:14px">История появится после первого редактирования: каждая редакция сохраняется автоматически.</p>') +
    '</section>' +
    '<div class="flex gap-2 flex-wrap"><button class="btn btn-danger" type="button" data-act="delete-song" data-id="' + song.id + '">' + icon('trash', 16) + 'Удалить песню</button></div>';
}
function infoRow(l, v) { return '<div class="info-row"><span class="info-label">' + escapeHtml(l) + '</span><span class="info-value">' + (v == null ? '—' : v) + '</span></div>'; }
function adjustTranspose(d) { State.ui.transpose = clamp((State.ui.transpose || 0) + d, -11, 11); renderSongDetail(State.ui.parts[1]); }
function resetTranspose() { State.ui.transpose = 0; renderSongDetail(State.ui.parts[1]); }
async function toggleFavorite(id) {
  const s = findSong(id); if (!s) return;
  s.favorite = !s.favorite;
  await saveSong(s);
  Toast.info(s.favorite ? 'Добавлено в избранное' : 'Убрано из избранного');
  if (State.ui.parts[1]) renderSongDetail(id); else renderSongList();
}
async function duplicateSong(id) {
  const s = findSong(id); if (!s) return;
  const c = JSON.parse(JSON.stringify(s));
  c.id = uid('song'); c.title = s.title + ' (копия)'; c.favorite = false; c.version = 1;
  c.fileIds = []; c.createdAt = nowISO(); c.updatedAt = nowISO();
  await saveSong(c);
  await logActivity('song', 'Создана копия песни «' + s.title + '»', c.id);
  Toast.success('Копия создана');
  navigate('#/songs/' + c.id);
}
function confirmDeleteSong(id) {
  const s = findSong(id); if (!s) return;
  Modal.confirm('Удалить песню?', '«' + s.title + '» будет удалена из каталога, из всех сет-листов и групп вместе с вложениями.', async () => {
    const copy = JSON.parse(JSON.stringify(s));
    const affected = State.setlists.filter(sl => (sl.items || []).some(i => i.songId === id)).map(sl => JSON.parse(JSON.stringify(sl)));
    await deleteSong(id);
    await logActivity('song', 'Удалена песня «' + s.title + '»', id);
    Toast.success('Песня удалена', { label: 'Вернуть', fn: async () => { await saveSong(copy); for (const sl of affected) await saveSetlist(sl); Toast.info('Восстановлено (без вложений)'); navigate('#/songs/' + copy.id); } });
    navigate('#/songs');
  }, 'Удалить', true);
}
async function snapshotVersion(song) {
  const v = { id: uid('ver'), songId: song.id, versionNumber: song.version || 1, data: JSON.parse(JSON.stringify(song)), createdAt: nowISO() };
  await dbPut('songVersions', v);
  State.songVersions.push(v);
  if (State.songVersions.length > 400) { const old = State.songVersions.shift(); dbDelete('songVersions', old.id); }
}
function restoreVersion(vid) {
  const v = State.songVersions.find(x => x.id === vid);
  if (!v) { Toast.error('Версия не найдена'); return; }
  const song = findSong(v.songId);
  if (!song) { Toast.error('Песня не найдена'); return; }
  Modal.confirm('Восстановить версию?', 'Содержимое песни «' + song.title + '» будет заменено версией от ' + formatDate(v.createdAt) + '. Текущая редакция сохранится в истории.', async () => {
    await snapshotVersion(song);
    const data = JSON.parse(JSON.stringify(v.data));
    data.id = song.id; data.version = (song.version || 1) + 1; data.createdAt = song.createdAt;
    await saveSong(data);
    await logActivity('song', 'Восстановлена версия «' + song.title + '»', song.id);
    Toast.success('Версия восстановлена');
    renderSongDetail(song.id);
  }, 'Восстановить');
}
async function deleteVersion(vid) {
  const v = State.songVersions.find(x => x.id === vid); if (!v) return;
  await dbDelete('songVersions', vid);
  State.songVersions = State.songVersions.filter(x => x.id !== vid);
  Toast.success('Версия удалена', { label: 'Вернуть', fn: async () => { State.songVersions.push(v); await dbPut('songVersions', v); if (State.ui.parts[1]) renderSongDetail(v.songId); } });
  if (State.ui.parts[1]) renderSongDetail(State.ui.parts[1]);
}
const SONG_TPL = '[Verse 1]\nG       C       D       G\nПервая строка текста\nG       D       C       G\nВторая строка текста\n\n[Chorus]\nC       G       D       Em\nСтрока припева\nC       D       G\nЗавершающая строка';
function openSongEditor(prefill) {
  prefill = prefill || {};
  const s = prefill.id ? findSong(prefill.id) : null;
  const isEdit = !!s;
  const draft = !isEdit ? readDraft(DRAFT_SONG) : null;
  const body =
    (draft ? '<div class="draft-banner"><span>📝</span><span>Найден несохранённый черновик от ' + escapeHtml(formatDateShort(draft.savedAt) + ' ' + formatTime(draft.savedAt)) + '</span>' +
      '<button class="btn btn-sm" type="button" id="sgDraftRestore">Восстановить</button><button class="btn btn-sm" type="button" id="sgDraftDrop">Удалить</button></div>' : '') +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="songTitle">Название *</label><input class="form-input" id="songTitle" type="text" maxlength="140" placeholder="Название песни" value="' + (s ? escapeHtml(s.title) : '') + '"></div>' +
      '<div class="form-group"><label class="form-label" for="songArtist">Исполнитель</label><input class="form-input" id="songArtist" type="text" placeholder="Исполнитель" value="' + (s ? escapeHtml(s.artist || '') : '') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="songAuthor">Автор</label><input class="form-input" id="songAuthor" type="text" placeholder="Автор текста / музыки" value="' + (s ? escapeHtml(s.author || '') : '') + '"></div>' +
      '<div class="form-group"><label class="form-label" for="songKey">Тональность</label>' +
        '<input class="form-input" id="songKey" type="text" list="keyList" placeholder="C, G, Am, Bb" value="' + (s ? escapeHtml(s.key || '') : '') + '">' +
        '<datalist id="keyList">' + ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B', 'Am', 'Em', 'Dm', 'Cm', 'Gm', 'F#m'].map(k => '<option value="' + k + '"></option>').join('') + '</datalist></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="songBpm">Темп (BPM)</label><input class="form-input" id="songBpm" type="number" min="20" max="400" inputmode="numeric" placeholder="72" value="' + (s && s.bpm ? s.bpm : '') + '"></div>' +
      '<div class="form-group"><label class="form-label" for="songTimeSig">Размер</label><select class="form-select" id="songTimeSig"><option value="">—</option>' +
        TIME_SIGNATURES.map(t => '<option value="' + t + '"' + (s && s.timeSignature === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>' +
      '<div class="form-group"><label class="form-label" for="songDuration">Длительность (сек)</label><input class="form-input" id="songDuration" type="number" min="0" max="3600" inputmode="numeric" placeholder="240" value="' + (s && s.duration ? s.duration : '') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="songGenre">Жанр</label><input class="form-input" id="songGenre" type="text" list="genreList" placeholder="Worship" value="' + (s ? escapeHtml(s.genre || '') : '') + '">' +
        '<datalist id="genreList">' + GENRES.map(g => '<option value="' + g + '"></option>').join('') + '</datalist></div>' +
      '<div class="form-group"><label class="form-label" for="songLang">Язык</label><input class="form-input" id="songLang" type="text" list="langList" placeholder="Русский" value="' + (s ? escapeHtml(s.language || '') : '') + '">' +
        '<datalist id="langList">' + ['Русский', 'English', 'Українська', 'Español', 'Deutsch', 'Français'].map(l => '<option value="' + l + '"></option>').join('') + '</datalist></div>' +
    '</div>' +
    '<div class="form-group"><label class="form-label" for="songTags">Теги (через запятую)</label><input class="form-input" id="songTags" type="text" placeholder="worship, modern, ballad" value="' + (s ? escapeHtml((s.tags || []).join(', ')) : '') + '"></div>' +
    '<div class="form-group"><label class="form-label" for="songLink">Ссылка на оригинал, демо, аудио или видео</label>' +
      '<input class="form-input" id="songLink" type="url" inputmode="url" placeholder="https://…" value="' + (s ? escapeHtml(s.link || '') : '') + '"></div>' +
    '<div class="form-group"><span class="form-label">Группы, исполняющие песню</span><div class="chip-row" id="songGroups">' +
      (State.groups.length ? State.groups.map(g => {
        const on = s && (s.groupIds || []).indexOf(g.id) >= 0;
        return '<label class="chip' + (on ? ' active' : '') + '" style="border-left:3px solid ' + escapeHtml(g.color || 'var(--accent)') + '"><input type="checkbox" value="' + g.id + '"' + (on ? ' checked' : '') + '>' + escapeHtml(g.name) + '</label>';
      }).join('') : '<p class="form-hint">Группы ещё не созданы.</p>') + '</div></div>' +
    '<div class="form-group"><label class="form-label" for="songLyrics">Текст песни и аккорды</label>' +
      '<textarea class="form-textarea" id="songLyrics" style="min-height:280px" spellcheck="false" placeholder="' + escapeHtml(SONG_TPL) + '">' + (s ? escapeHtml(s.lyrics || '') : '') + '</textarea>' +
      '<span class="form-hint">Аккорды — отдельной строкой над текстом. Поддержка: C, Cm, C7, Cmaj7, Cmaj9, Cadd9, Csus2, Csus4, C/E, F#m7, Bb, G#dim. Секции — [Verse 1], [Chorus], [Bridge].</span></div>' +
    '<div class="form-group"><label class="form-label" for="songNotes">Заметки для музыкантов</label>' +
      '<textarea class="form-textarea" id="songNotes" style="min-height:70px;font-family:var(--font);font-size:14px" placeholder="Динамика, вступление, соло, особенности аранжировки">' + (s ? escapeHtml(s.notes || '') : '') + '</textarea></div>' +
    (isEdit ? fileListHTML(s.fileIds, 'song', s.id) : '<p class="form-hint">Вложенные файлы (PDF, изображения, аудио, документы) можно прикрепить после сохранения песни.</p>') +
    '<div class="form-error" id="songError" role="alert" hidden></div>';
  Modal.show(isEdit ? 'Редактировать песню' : 'Новая песня', body,
    (isEdit ? '<button class="btn btn-danger" type="button" data-act="delete-song" data-id="' + s.id + '" data-modal-close>' + icon('trash', 16) + '</button>' : '') +
    '<span class="autosave-note" id="songAutosave">Черновик сохраняется автоматически</span>' +
    '<button class="btn" type="button" data-modal-close>Отмена</button>' +
    '<button class="btn btn-primary" type="button" id="saveSongBtn">' + (isEdit ? 'Сохранить' : 'Создать песню') + '</button>',
    { size: 'modal-lg', onMount: mountSongEditor });

  function mountSongEditor() {
    $$('#songGroups input').forEach(cb => cb.addEventListener('change', () => cb.closest('.chip').classList.toggle('active', cb.checked), { passive: true }));
    const lyr = $('#songLyrics');
    const saveDraftFn = debounce(() => {
      if (isEdit) return;
      const t = $('#songTitle').value.trim();
      if (!t && !lyr.value.trim()) { writeDraft(DRAFT_SONG, null); return; }
      writeDraft(DRAFT_SONG, {
        title: t, artist: $('#songArtist').value, author: $('#songAuthor').value, key: $('#songKey').value,
        bpm: $('#songBpm').value, timeSignature: $('#songTimeSig').value, duration: $('#songDuration').value,
        genre: $('#songGenre').value, language: $('#songLang').value, tags: $('#songTags').value, link: $('#songLink').value,
        lyrics: lyr.value, notes: $('#songNotes').value, savedAt: nowISO()
      });
      const n = $('#songAutosave'); if (n) n.textContent = 'Черновик сохранён в ' + formatTime(new Date());
    }, 800);
    ['songTitle', 'songArtist', 'songAuthor', 'songKey', 'songBpm', 'songDuration', 'songGenre', 'songLang', 'songTags', 'songLink', 'songNotes', 'songLyrics'].forEach(idf => {
      const x = $('#' + idf); if (x) x.addEventListener('input', saveDraftFn, { passive: true });
    });
    const ts = $('#songTimeSig'); if (ts) ts.addEventListener('change', saveDraftFn, { passive: true });
    const ctrlS = ev => {
      if ((ev.ctrlKey || ev.metaKey) && ['s', 'S', 'ы', 'Ы'].indexOf(ev.key) >= 0) {
        if (!Modal.isOpen()) { document.removeEventListener('keydown', ctrlS); return; }
        ev.preventDefault(); const b = $('#saveSongBtn'); if (b) b.click();
      }
    };
    document.addEventListener('keydown', ctrlS);
    const dr = $('#sgDraftRestore');
    if (dr) dr.addEventListener('click', () => {
      const d = readDraft(DRAFT_SONG); if (!d) return;
      Object.keys(d).forEach(k => { const elx = $('#' + ({ timeSignature: 'songTimeSig', language: 'songLang' }[k] || 'song' + k.charAt(0).toUpperCase() + k.slice(1))); if (elx) elx.value = d[k] || ''; });
      Toast.success('Черновик восстановлен');
    });
    const dd = $('#sgDraftDrop');
    if (dd) dd.addEventListener('click', () => { writeDraft(DRAFT_SONG, null); const b = $('.draft-banner'); if (b) b.remove(); Toast.info('Черновик удалён'); });
    $('#saveSongBtn').addEventListener('click', saveHandler);
  }
  async function saveHandler(ev) {
    const btn = ev.currentTarget;
    btn.classList.add('loading');
    const fail = (m, f) => {
      btn.classList.remove('loading');
      const er = $('#songError'); er.textContent = m; er.hidden = false;
      $$('.form-input.error, .form-textarea.error, .form-select.error').forEach(x => x.classList.remove('error'));
      const x = $('#' + f); if (x) { x.classList.add('error'); x.focus(); }
    };
    const title = $('#songTitle').value.trim();
    if (!title) return fail('Введите название песни', 'songTitle');
    const keyVal = $('#songKey').value.trim();
    if (keyVal && !/^[A-G][#b]?/.test(keyVal)) return fail('Тональность должна начинаться с ноты A–G (C, Am, Bb, F#)', 'songKey');
    const bpmRaw = $('#songBpm').value.trim(), bpm = bpmRaw ? parseInt(bpmRaw, 10) : null;
    if (bpm !== null && (isNaN(bpm) || bpm < 20 || bpm > 400)) return fail('BPM должен быть в диапазоне 20–400', 'songBpm');
    const durRaw = $('#songDuration').value.trim(), dur = durRaw ? parseInt(durRaw, 10) : null;
    if (dur !== null && (isNaN(dur) || dur < 0 || dur > 3600)) return fail('Длительность: 0–3600 секунд', 'songDuration');
    const link = $('#songLink').value.trim();
    if (link && !/^(https?:\/\/|www\.)/i.test(link)) return fail('Ссылка должна начинаться с http:// или https://', 'songLink');
    if (isEdit) await snapshotVersion(s);
    const song = s ? Object.assign({}, s) : { id: uid('song'), createdAt: nowISO(), favorite: false, version: 1, fileIds: [] };
    song.title = title;
    song.artist = $('#songArtist').value.trim();
    song.author = $('#songAuthor').value.trim();
    song.key = keyVal || null;
    song.bpm = bpm; song.duration = dur;
    song.timeSignature = $('#songTimeSig').value || '';
    song.genre = $('#songGenre').value.trim();
    song.language = $('#songLang').value.trim();
    song.tags = $('#songTags').value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 24);
    song.link = link;
    song.groupIds = $$('#songGroups input:checked').map(c => c.value);
    song.lyrics = $('#songLyrics').value;
    song.notes = $('#songNotes').value.trim();
    song.version = (song.version || 1) + (isEdit ? 1 : 0);
    await saveSong(song);
    await logActivity('song', (isEdit ? 'Обновлена песня «' : 'Добавлена песня «') + song.title + '»', song.id);
    if (!isEdit) writeDraft(DRAFT_SONG, null);
    Modal.close();
    Toast.success(isEdit ? 'Песня сохранена' : 'Песня добавлена в каталог');
    State.ui.transpose = 0;
    navigate('#/songs/' + song.id);
  }
}
function songToText(song, tr) {
  const t = tr || 0, lines = [song.title, '='.repeat(Math.max(10, song.title.length))];
  const meta = [];
  if (song.artist || song.author) meta.push((song.artist ? 'Исполнитель: ' + song.artist : '') + (song.author ? ' · Автор: ' + song.author : ''));
  if (song.key) meta.push('Тональность: ' + transposeKey(song.key, t));
  if (song.bpm) meta.push('BPM: ' + song.bpm);
  if (song.timeSignature) meta.push('Размер: ' + song.timeSignature);
  if (song.genre) meta.push('Жанр: ' + song.genre);
  if (song.duration) meta.push('Время: ' + durationLabel(song.duration));
  if (song.tags && song.tags.length) meta.push('Теги: ' + song.tags.join(', '));
  if (meta.length) lines.push(meta.join(' | '));
  lines.push('', transposeLyricsText(song.lyrics, t));
  if (song.notes) lines.push('', 'Заметки:', song.notes);
  if (song.link) lines.push('Ссылка: ' + song.link);
  return lines.join('\n');
}
function songToSetlist(songId) {
  const s = findSong(songId); if (!s) return;
  if (!State.setlists.length) { Modal.confirm('Нет сет-листов', 'Чтобы добавить песню, сначала создайте сет-лист. Создать сейчас?', () => openSetlistEditor({ songId }), 'Создать сет-лист'); return; }
  Modal.show('Добавить «' + s.title + '» в сет-лист',
    '<div class="filter-search mb-2" style="max-width:none">' + icon('search', 16) + '<input type="search" id="slPickSearch" placeholder="Поиск сет-листа…" aria-label="Поиск сет-листа"></div><div id="slPickList" style="max-height:48vh;overflow-y:auto"></div>',
    '', { onMount() {
      const render = q => {
        const items = State.setlists.filter(sl => !q || sl.name.toLowerCase().indexOf(q.toLowerCase()) >= 0);
        $('#slPickList').innerHTML = items.length ? items.map(sl => {
          const has = (sl.items || []).some(i => i.songId === s.id);
          return '<div class="search-result-item" role="button" tabindex="0" data-pick="' + sl.id + '"><span class="search-result-icon">📋</span><div style="min-width:0">' +
            '<div class="search-result-title">' + escapeHtml(sl.name) + '</div><div class="search-result-meta">' +
            (sl.items || []).length + ' ' + plural((sl.items || []).length, 'песня', 'песни', 'песен') + ' · ' + SETLIST_STATUS[sl.status || 'active'] + (has ? ' · уже добавлена' : '') + '</div></div></div>';
        }).join('') : '<p class="text-muted text-center" style="padding:20px">Ничего не найдено</p>';
        $$('[data-pick]').forEach(it => {
          const go = async () => {
            const sl = findSetlist(it.getAttribute('data-pick')); if (!sl) return;
            if ((sl.items || []).some(i => i.songId === s.id)) { Toast.info('Песня уже есть в этом сет-листе'); Modal.close(); return; }
            sl.items = sl.items || [];
            sl.items.push({ id: uid('si'), songId: s.id, position: sl.items.length, keyOverride: null, bpmOverride: null, notes: '', transition: '', leadMemberId: null });
            await saveSetlist(sl);
            await logActivity('setlist', '«' + s.title + '» добавлена в «' + sl.name + '»', sl.id);
            Modal.close();
            Toast.success('Добавлено в «' + sl.name + '»', { label: 'Открыть', fn: () => navigate('#/band/setlist/' + sl.id) });
          };
          it.addEventListener('click', go);
          it.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
        });
      };
      render('');
      $('#slPickSearch').addEventListener('input', debounce(ev => render(ev.target.value), 160), { passive: true });
    } });
}

/* ═══ SECTION 10: BAND (SETLISTS + GROUPS + MEMBERS) ═══ */
function renderBand() {
  const tab = State.ui.bandTab || 'setlists';
  $('#content').innerHTML =
    '<div class="page-header"><div><h1 class="page-title">Сет-листы и группы</h1>' +
      '<p class="page-subtitle">' + State.setlists.length + ' ' + plural(State.setlists.length, 'сет-лист', 'сет-листа', 'сет-листов') + ' · ' +
      State.groups.length + ' ' + plural(State.groups.length, 'группа', 'группы', 'групп') + ' · ' +
      State.members.length + ' ' + plural(State.members.length, 'участник', 'участника', 'участников') + '</p></div>' +
      '<div class="page-actions"><button class="btn btn-primary" type="button" data-act="new-' + (tab === 'songs' ? 'song' : tab === 'groups' ? 'group' : tab === 'members' ? 'member' : 'setlist') + '" id="bandCreateBtn">' + icon('plus', 18) + '<span id="bandCreateLabel">Сет-лист</span></button></div></div>' +
    '<div class="tabs" id="bandTabs" role="tablist">' +
      [['setlists', 'Сет-листы'], ['groups', 'Группы'], ['members', 'Участники']].map(t =>
        '<button class="tab' + (tab === t[0] ? ' active' : '') + '" role="tab" aria-selected="' + (tab === t[0]) + '" type="button" data-act="band-tab" data-val="' + t[0] + '">' + t[1] + '</button>').join('') +
    '</div><div id="bandContent"></div>';
  renderBandContent();
}
function renderBandContent() {
  const tab = State.ui.bandTab || 'setlists';
  const lbl = $('#bandCreateLabel');
  if (lbl) lbl.textContent = tab === 'groups' ? 'Группа' : tab === 'members' ? 'Участник' : 'Сет-лист';
  const btn = $('#bandCreateBtn');
  if (btn) btn.setAttribute('data-act', tab === 'groups' ? 'new-group' : tab === 'members' ? 'new-member' : 'new-setlist');
  const el = $('#bandContent'); if (!el) return;
  if (tab === 'groups') renderGroupsTab(el);
  else if (tab === 'members') renderMembersTab(el);
  else renderSetlistsTab(el);
}
function renderSetlistsTab(el) {
  const q = (State.ui.bandQuery || '').toLowerCase();
  const list = State.setlists.filter(s => !q || s.name.toLowerCase().indexOf(q) >= 0).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  el.innerHTML = '<div class="calendar-filters"><div class="filter-search">' + icon('search', 16) +
    '<input type="search" id="bandSearch" placeholder="Поиск сет-листов…" value="' + escapeHtml(State.ui.bandQuery) + '" aria-label="Поиск сет-листов"></div></div>' +
    '<div id="setlistList" class="grid grid-2"></div>';
  const inp = $('#bandSearch');
  inp.addEventListener('input', debounce(() => { State.ui.bandQuery = inp.value; renderSetlistsTab(el); }, 170), { passive: true });
  const cont = $('#setlistList');
  if (!list.length) {
    cont.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📋</div><div class="empty-state-title">Нет сет-листов</div>' +
      '<div class="empty-state-text">Сет-лист — программа репетиции, концерта или служения: песни в нужном порядке, тональности, ответственные и переходы.</div>' +
      '<button class="btn btn-primary" data-act="new-setlist">' + icon('plus', 18) + 'Создать сет-лист</button></div>';
    return;
  }
  renderChunked(cont, list, sl => {
    const st = setlistStats(sl), g = findGroup(sl.groupId), ev = State.events.find(e => e.setlistId === sl.id);
    return '<article class="song-card" data-sl="' + sl.id + '" role="link" tabindex="0">' +
      '<div class="song-card-title">' + escapeHtml(sl.name) + '</div>' +
      '<div class="song-card-meta"><span>' + icon('music', 13) + ' ' + st.count + '</span>' +
        (st.duration ? '<span>' + icon('clock', 13) + ' ' + durationLabel(st.duration) + '</span>' : '') +
        (st.avgBpm ? '<span>🥁 ' + st.avgBpm + ' BPM</span>' : '') +
        (g ? '<span>' + icon('users', 13) + ' ' + escapeHtml(g.name) + '</span>' : '') +
        (ev ? '<span>' + icon('calendar', 13) + ' ' + escapeHtml(formatDateShort(ev.start)) + '</span>' : '') + '</div>' +
      '<div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap"><span class="badge ' + (sl.status === 'draft' ? 'badge-muted' : sl.status === 'done' ? 'badge-success' : sl.status === 'archived' ? 'badge-warning' : 'badge-accent') + '">' + SETLIST_STATUS[sl.status || 'active'] + '</span></div>' +
      (sl.notes ? '<div style="font-size:13px;color:var(--text-muted);margin-top:8px">' + escapeHtml(sl.notes) + '</div>' : '') + '</article>';
  }, 20);
}
function renderGroupsTab(el) {
  const q = (State.ui.bandQuery || '').toLowerCase();
  const showArch = State.ui.filters.showArchived;
  const list = State.groups.filter(g => (showArch || g.status !== 'archived') && (!q || g.name.toLowerCase().indexOf(q) >= 0 || (g.description || '').toLowerCase().indexOf(q) >= 0));
  el.innerHTML = '<div class="calendar-filters"><div class="filter-search">' + icon('search', 16) +
    '<input type="search" id="bandSearch" placeholder="Поиск групп…" value="' + escapeHtml(State.ui.bandQuery) + '" aria-label="Поиск групп"></div>' +
    '<label class="chip' + (showArch ? ' active' : '') + '"><input type="checkbox" id="showArchived"' + (showArch ? ' checked' : '') + '>Показывать архив</label></div>' +
    '<div id="groupList" class="grid grid-2"></div>';
  const inp = $('#bandSearch');
  inp.addEventListener('input', debounce(() => { State.ui.bandQuery = inp.value; renderGroupsTab(el); }, 170), { passive: true });
  $('#showArchived').addEventListener('change', ev => { State.ui.filters.showArchived = ev.target.checked; ev.target.closest('.chip').classList.toggle('active', ev.target.checked); renderGroupsTab(el); }, { passive: true });
  const cont = $('#groupList');
  if (!list.length) {
    cont.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">👥</div><div class="empty-state-title">Нет групп</div>' +
      '<div class="empty-state-text">Группа объединяет участников с ролями, песни, репетиции, выступления и сет-листы одного коллектива.</div>' +
      '<button class="btn btn-primary" data-act="new-group">' + icon('plus', 18) + 'Создать группу</button></div>';
    return;
  }
  cont.innerHTML = list.map(g => {
    const mem = State.members.filter(m => (m.groupIds || []).indexOf(g.id) >= 0);
    const evts = State.events.filter(e => e.groupId === g.id && new Date(e.start) >= new Date());
    const sls = State.setlists.filter(s => s.groupId === g.id);
    const songs = State.songs.filter(s => (s.groupIds || []).indexOf(g.id) >= 0);
    return '<article class="card group-card" data-group="' + g.id + '" role="link" tabindex="0">' +
      '<div class="group-card-color" style="background:' + escapeHtml(g.color || 'var(--accent)') + '"></div>' +
      '<div class="flex gap-2 items-center" style="align-items:flex-start">' +
        (g.logoFileId ? '<span class="group-logo" style="display:flex;align-items:center;justify-content:center;font-size:26px">🎼</span>' : '') +
        '<div style="flex:1;min-width:0"><div class="song-card-title" style="padding-right:0">' + escapeHtml(g.name) +
        (g.status === 'archived' ? ' <span class="badge badge-warning">Архив</span>' : '') + '</div>' +
        '<div class="song-card-meta"><span>' + icon('users', 13) + ' ' + mem.length + '</span><span>' + icon('music', 13) + ' ' + songs.length + '</span>' +
        '<span>' + icon('calendar', 13) + ' ' + evts.length + '</span><span>' + icon('list', 13) + ' ' + sls.length + '</span></div></div></div>' +
      (g.description ? '<div style="font-size:13px;color:var(--text-muted);margin-top:8px">' + escapeHtml(g.description) + '</div>' : '') +
      (mem.length ? '<div class="event-participants"><span class="avatar-stack">' + mem.slice(0, 7).map(m =>
        '<span class="mini-avatar" style="background:' + escapeHtml(m.color || 'var(--accent)') + '" title="' + escapeHtml(m.name) + '">' + escapeHtml((m.name || '?')[0].toUpperCase()) + '</span>').join('') +
        (mem.length > 7 ? '<span class="mini-avatar mini-more">+' + (mem.length - 7) + '</span>' : '') + '</span></div>' : '') + '</article>';
  }).join('');
}
function renderMembersTab(el) {
  const q = (State.ui.bandQuery || '').toLowerCase();
  const list = State.members.filter(m => !q || m.name.toLowerCase().indexOf(q) >= 0 || (m.roles || []).some(r => r.toLowerCase().indexOf(q) >= 0));
  el.innerHTML = '<div class="calendar-filters"><div class="filter-search">' + icon('search', 16) +
    '<input type="search" id="bandSearch" placeholder="Поиск участников и ролей…" value="' + escapeHtml(State.ui.bandQuery) + '" aria-label="Поиск участников"></div></div>' +
    '<div id="memberList" class="grid grid-2"></div>';
  const inp = $('#bandSearch');
  inp.addEventListener('input', debounce(() => { State.ui.bandQuery = inp.value; renderMembersTab(el); }, 170), { passive: true });
  const cont = $('#memberList');
  if (!list.length) {
    cont.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🎤</div><div class="empty-state-title">Нет участников</div>' +
      '<div class="empty-state-text">Добавьте музыкантов, укажите роли и контакты — и отмечайте состав на каждое событие.</div>' +
      '<button class="btn btn-primary" data-act="new-member">' + icon('plus', 18) + 'Добавить участника</button></div>';
    return;
  }
  cont.innerHTML = list.map(m => {
    const evts = State.events.filter(e => (e.participants || []).some(p => p.memberId === m.id) && new Date(e.start) >= new Date());
    const c = m.contacts || {};
    return '<article class="member-card" data-member="' + m.id + '" role="button" tabindex="0">' +
      '<div class="member-avatar" style="background:' + escapeHtml(m.color || 'var(--accent)') + '">' + escapeHtml((m.name || '?')[0].toUpperCase()) + '</div>' +
      '<div class="member-info"><div class="member-name">' + escapeHtml(m.name) + '</div>' +
      '<div class="member-roles">' + ((m.roles || []).map(r => '<span class="role-tag" style="background:' + hexToRgba(ROLE_COLORS[r] || '#9ca3af', 0.16) + ';color:' + (ROLE_COLORS[r] || '#9ca3af') + '">' + escapeHtml(r) + '</span>').join('') || '<span class="text-muted">Роль не указана</span>') + '</div>' +
      '<div class="member-contacts">' +
        (c.phone ? '<a class="contact-link" href="tel:' + escapeHtml(c.phone.replace(/[^+\d]/g, '')) + '" onclick="event.stopPropagation()">📞 ' + escapeHtml(c.phone) + '</a>' : '') +
        (c.email ? '<a class="contact-link" href="mailto:' + escapeHtml(c.email) + '" onclick="event.stopPropagation()">✉️ ' + escapeHtml(c.email) + '</a>' : '') +
        (c.telegram ? '<a class="contact-link" href="https://t.me/' + escapeHtml(c.telegram.replace('@', '')) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">✈️ ' + escapeHtml(c.telegram) + '</a>' : '') +
        (c.whatsapp ? '<a class="contact-link" href="https://wa.me/' + escapeHtml(c.whatsapp.replace(/[^+\d]/g, '')) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">💬 WhatsApp</a>' : '') +
      '</div>' +
      '<div class="form-hint" style="margin-top:6px">' + evts.length + ' ' + plural(evts.length, 'предстоящее событие', 'предстоящих события', 'предстоящих событий') + '</div></div>' +
      '<span class="badge ' + (m.status === 'active' ? 'badge-success' : m.status === 'invited' ? 'badge-accent' : m.status === 'paused' ? 'badge-warning' : 'badge-muted') + '">' + MEMBER_STATUS[m.status || 'active'] + '</span>' +
      '</article>';
  }).join('');
}
function setlistStats(sl) {
  const items = sl.items || [];
  let dur = 0, bpmSum = 0, n = 0;
  items.forEach(it => { const s = findSong(it.songId); if (!s) return; dur += s.duration || 0; const b = it.bpmOverride || s.bpm; if (b) { bpmSum += b; n++; } });
  return { count: items.length, duration: dur, avgBpm: n ? Math.round(bpmSum / n) : 0 };
}
function renderSetlistDetail(id) {
  const sl = findSetlist(id);
  if (!sl) { Toast.error('Сет-лист не найден'); navigate('#/band'); return; }
  const st = setlistStats(sl), g = findGroup(sl.groupId);
  const linked = State.events.filter(e => e.setlistId === sl.id).sort((a, b) => new Date(a.start) - new Date(b.start));
  $('#content').innerHTML =
    '<div class="page-header"><div>' +
      '<button class="btn btn-sm mb-2" data-go="#/band">' + icon('arrowLeft', 16) + 'К сет-листам</button>' +
      '<h1 class="page-title">' + escapeHtml(sl.name) + '</h1>' +
      '<p class="page-subtitle">' + st.count + ' ' + plural(st.count, 'песня', 'песни', 'песен') + ' · ' + durationLabel(st.duration) + ' · ' +
        (st.avgBpm ? st.avgBpm + ' BPM' : 'темп не задан') + (g ? ' · ' + escapeHtml(g.name) : '') + ' · ' + SETLIST_STATUS[sl.status || 'active'] + '</p>' +
    '</div><div class="page-actions">' +
      '<button class="btn btn-primary" type="button" data-act="launch-scene" data-id="' + sl.id + '">' + icon('stage', 16) + 'Сцена</button>' +
      '<button class="btn" type="button" data-act="edit-setlist" data-id="' + sl.id + '">' + icon('edit', 16) + '</button>' +
      '<button class="btn" type="button" data-act="print-setlist-full" data-id="' + sl.id + '">' + icon('print', 16) + '</button>' +
      '<button class="btn" type="button" data-act="export-setlist" data-id="' + sl.id + '">' + icon('download', 16) + '</button>' +
      '<button class="btn" type="button" data-act="duplicate-setlist" data-id="' + sl.id + '">' + icon('copy', 16) + '</button>' +
    '</div></div>' +
    '<div class="card mb-4"><h2 class="section-title">Статус сет-листа</h2><div class="chip-row" id="slStatusChips">' +
      Object.keys(SETLIST_STATUS).map(k => '<button class="chip' + ((sl.status || 'active') === k ? ' active' : '') + '" type="button" data-act="sl-status" data-id="' + sl.id + '" data-val="' + k + '">' + SETLIST_STATUS[k] + '</button>').join('') +
    '</div></div>' +
    (linked.length ? '<div class="card mb-4"><h2 class="section-title">Связанные события</h2>' + linked.map(e => occurrenceCardHTML({ ev: e, start: new Date(e.start), end: new Date(e.end || e.start), key: e.id, single: true }, false)).join('') + '</div>' : '') +
    '<section class="card mb-4"><div class="flex items-center justify-between flex-wrap gap-2">' +
      '<h2 class="section-title" style="margin:0">Программа</h2>' +
      '<div class="flex gap-2 flex-wrap"><button class="btn btn-sm" type="button" data-act="print-setlist-short" data-id="' + sl.id + '">Печать (кратко)</button>' +
      '<button class="btn btn-sm btn-primary" type="button" data-act="add-song-to-setlist" data-id="' + sl.id + '">' + icon('plus', 16) + 'Песня</button></div></div>' +
      '<p class="form-hint mt-2">Перетаскивайте за ручку (работает на телефоне) или используйте стрелки. Для каждой песни — своя тональность, темп, ответственный и переход.</p>' +
      '<div id="setlistItems" style="margin-top:14px"></div><div class="setlist-stats mt-4" id="setlistStats"></div></section>' +
    (sl.notes ? '<section class="card mb-4"><h2 class="section-title">Общие заметки</h2><p style="font-size:14px;color:var(--text-muted);white-space:pre-wrap">' + escapeHtml(sl.notes) + '</p></section>' : '') +
    '<div class="flex gap-2 flex-wrap"><button class="btn btn-danger" type="button" data-act="delete-setlist" data-id="' + sl.id + '">' + icon('trash', 16) + 'Удалить сет-лист</button></div>';
  renderSetlistItems(sl);
}
function renderSetlistItems(sl) {
  const el = $('#setlistItems'); if (!el) return;
  const items = sl.items || [];
  if (!items.length) {
    el.innerHTML = emptyBlock('🎶', 'Программа пуста', 'Добавьте песни из каталога — они появятся здесь в нужном порядке.', 'add-song-to-setlist', 'Добавить песню', sl.id);
  } else {
    el.innerHTML = items.map((it, i) => {
      const s = findSong(it.songId);
      if (!s) return '<div class="setlist-item"><div class="setlist-item-num">' + (i + 1) + '</div><div class="setlist-item-info"><div class="setlist-item-title text-muted">Песня удалена из каталога</div></div>' +
        '<div class="setlist-item-actions"><button class="danger" type="button" data-act="sl-remove" data-sl="' + sl.id + '" data-item="' + it.id + '" aria-label="Удалить">' + icon('x', 16) + '</button></div></div>';
      const lead = it.leadMemberId ? findMember(it.leadMemberId) : null;
      const meta = [it.keyOverride || s.key || '—', (it.bpmOverride || s.bpm || '—') + ' BPM', s.duration ? durationLabel(s.duration) : '', lead ? '🎤 ' + lead.name : '', it.transition ? '↦ ' + it.transition : '', it.notes ? '✎ ' + it.notes : ''].filter(Boolean).join(' · ');
      return '<div class="setlist-item" data-item="' + it.id + '" data-index="' + i + '">' +
        '<span class="setlist-item-handle" role="button" tabindex="0" aria-label="Перетащить ' + escapeHtml(s.title) + '">' + icon('grip', 18) + '</span>' +
        '<div class="setlist-item-num">' + (i + 1) + '</div>' +
        '<div class="setlist-item-info" data-act="sl-song" data-id="' + s.id + '" role="link" tabindex="0">' +
          '<div class="setlist-item-title">' + escapeHtml(s.title) + ((it.keyOverride || it.bpmOverride) ? ' <span class="badge badge-warning" style="font-size:10px">изменено</span>' : '') + '</div>' +
          '<div class="setlist-item-meta">' + escapeHtml(meta) + '</div></div>' +
        '<div class="setlist-item-actions">' +
          '<button type="button" data-act="sl-up" data-sl="' + sl.id + '" data-item="' + it.id + '" aria-label="Вверх"' + (i === 0 ? ' disabled' : '') + '>' + icon('up', 16) + '</button>' +
          '<button type="button" data-act="sl-down" data-sl="' + sl.id + '" data-item="' + it.id + '" aria-label="Вниз"' + (i === items.length - 1 ? ' disabled' : '') + '>' + icon('down', 16) + '</button>' +
          '<button type="button" data-act="sl-edit-item" data-sl="' + sl.id + '" data-item="' + it.id + '" aria-label="Параметры песни">' + icon('edit', 16) + '</button>' +
          '<button type="button" class="danger" data-act="sl-remove" data-sl="' + sl.id + '" data-item="' + it.id + '" aria-label="Убрать">' + icon('x', 16) + '</button>' +
        '</div></div>';
    }).join('');
  }
  const statsEl = $('#setlistStats');
  if (statsEl) {
    const st = setlistStats(sl);
    statsEl.innerHTML = '<span class="badge badge-accent">' + st.count + ' ' + plural(st.count, 'песня', 'песни', 'песен') + '</span>' +
      '<span class="badge badge-muted">' + icon('clock', 13) + ' ориентировочно ' + durationLabel(st.duration) + '</span>' +
      '<span class="badge badge-muted">🥁 средний темп ' + (st.avgBpm || '—') + '</span>';
  }
  setupSetlistDnD(sl, el);
}
function setupSetlistDnD(sl, listEl) {
  $$('.setlist-item', listEl).forEach(item => {
    const handle = $('.setlist-item-handle', item);
    if (!handle) return;
    makeDraggable(handle, {
      onStart() { State.ui.dragging = true; item.classList.add('dragging'); },
      onMove(ev, dx, dy) {
        item.style.transform = 'translateY(' + dy + 'px)';
        const after = getDragAfter(listEl, ev.clientY);
        if (after == null) listEl.appendChild(item); else listEl.insertBefore(item, after);
      },
      onEnd() { State.ui.dragging = false; item.classList.remove('dragging'); item.style.transform = ''; persistSetlistOrder(sl, listEl); },
      onTap() {}
    });
    handle.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); moveSetlistItem(sl.id, item.getAttribute('data-item'), ev.key === 'ArrowUp' ? -1 : 1); }
    });
  });
}
function getDragAfter(container, y) {
  const els = $$('.setlist-item:not(.dragging)', container);
  let best = { off: Number.NEGATIVE_INFINITY, el: null };
  els.forEach(c => { const b = c.getBoundingClientRect(), o = y - b.top - b.height / 2; if (o < 0 && o > best.off) best = { off: o, el: c }; });
  return best.el;
}
async function persistSetlistOrder(sl, listEl) {
  const order = $$('.setlist-item', listEl).map(x => x.getAttribute('data-item'));
  const map = {}; (sl.items || []).forEach(i => { map[i.id] = i; });
  const next = order.map(id => map[id]).filter(Boolean);
  if (next.length !== (sl.items || []).length || !next.some((it, i) => (sl.items || [])[i] !== it)) return;
  sl.items = next;
  await saveSetlist(sl);
  await logActivity('setlist', 'Изменён порядок песен в «' + sl.name + '»', sl.id);
  Toast.success('Порядок обновлён');
  renderSetlistItems(sl);
}
async function moveSetlistItem(slId, itemId, dir) {
  const sl = findSetlist(slId); if (!sl) return;
  const items = sl.items || [], i = items.findIndex(x => x.id === itemId), j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return;
  const tmp = items[i]; items[i] = items[j]; items[j] = tmp;
  sl.items = items;
  await saveSetlist(sl);
  renderSetlistItems(sl);
}
function openSetlistEditor(prefill) {
  prefill = prefill || {};
  const sl = prefill.id ? findSetlist(prefill.id) : null;
  const isEdit = !!sl;
  const curEvent = sl ? (State.events.find(x => x.setlistId === sl.id) || {}).id : (prefill.eventId || null);
  const body =
    '<div class="form-group"><label class="form-label" for="slName">Название *</label>' +
      '<input class="form-input" id="slName" type="text" maxlength="120" placeholder="Например: Воскресное служение, 12 января" value="' + (sl ? escapeHtml(sl.name) : '') + '"></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="slGroup">Группа</label><select class="form-select" id="slGroup"><option value="">—</option>' +
        State.groups.map(g => '<option value="' + g.id + '"' + (sl && sl.groupId === g.id ? ' selected' : '') + '>' + escapeHtml(g.name) + '</option>').join('') + '</select></div>' +
      '<div class="form-group"><label class="form-label" for="slStatus">Статус</label><select class="form-select" id="slStatus">' +
        Object.keys(SETLIST_STATUS).map(k => '<option value="' + k + '"' + ((sl ? (sl.status || 'active') : 'active') === k ? ' selected' : '') + '>' + SETLIST_STATUS[k] + '</option>').join('') + '</select></div>' +
    '</div>' +
    '<div class="form-group"><label class="form-label" for="slEvent">Привязать к событию в календаре</label><select class="form-select" id="slEvent"><option value="">—</option>' +
      State.events.slice().sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 50).map(e =>
        '<option value="' + e.id + '"' + (curEvent === e.id ? ' selected' : '') + '>' + escapeHtml(e.title + ' · ' + formatDateShort(e.start)) + '</option>').join('') + '</select></div>' +
    '<div class="form-group"><label class="form-label" for="slNotes">Общие заметки (переходы, вступления, финалы, техника)</label>' +
      '<textarea class="form-textarea" id="slNotes" style="min-height:84px;font-family:var(--font);font-size:14px" placeholder="Между песнями 3 и 4 — переход без паузы; финал — общий акцент">' + (sl ? escapeHtml(sl.notes || '') : '') + '</textarea></div>' +
    '<div class="form-error" id="slError" role="alert" hidden></div>';
  Modal.show(isEdit ? 'Настройки сет-листа' : 'Новый сет-лист', body,
    '<button class="btn" type="button" data-modal-close>Отмена</button><button class="btn btn-primary" type="button" id="saveSetlistBtn">' + (isEdit ? 'Сохранить' : 'Создать') + '</button>',
    { onMount() {
        $('#saveSetlistBtn').addEventListener('click', async ev => {
          const btn = ev.currentTarget, name = $('#slName').value.trim();
          if (!name) { const er = $('#slError'); er.textContent = 'Введите название сет-листа'; er.hidden = false; $('#slName').classList.add('error'); $('#slName').focus(); return; }
          btn.classList.add('loading');
          const target = sl || { id: uid('set'), items: [], createdAt: nowISO() };
          const prevEv = sl ? (State.events.find(x => x.setlistId === sl.id) || {}).id : null;
          target.name = name;
          target.groupId = $('#slGroup').value || null;
          target.status = $('#slStatus').value;
          target.notes = $('#slNotes').value.trim();
          const newEv = $('#slEvent').value || null;
          await saveSetlist(target);
          if (prevEv && prevEv !== newEv) { const pe = findEvent(prevEv); if (pe) { pe.setlistId = null; await saveEvent(pe); } }
          if (newEv) { const e2 = findEvent(newEv); if (e2) { e2.setlistId = target.id; await saveEvent(e2); } }
          if (prefill.songId) {
            const s = findSong(prefill.songId);
            if (s && !(target.items || []).some(i => i.songId === s.id)) {
              target.items = target.items || [];
              target.items.push({ id: uid('si'), songId: s.id, position: target.items.length, keyOverride: null, bpmOverride: null, notes: '', transition: '', leadMemberId: null });
              await saveSetlist(target);
            }
          }
          await logActivity('setlist', (isEdit ? 'Обновлён сет-лист «' : 'Создан сет-лист «') + name + '»', target.id);
          Modal.close();
          Toast.success(isEdit ? 'Сет-лист обновлён' : 'Сет-лист создан');
          navigate('#/band/setlist/' + target.id);
        });
      } });
}
function addSongToSetlist(slId) {
  const sl = findSetlist(slId); if (!sl) return;
  if (!State.songs.length) { Modal.confirm('Каталог пуст', 'Сначала добавьте хотя бы одну песню, затем вернитесь к сет-листу.', () => openSongEditor(), 'Добавить песню'); return; }
  Modal.show('Добавить песню в «' + sl.name + '»',
    '<div class="filter-search mb-2" style="max-width:none">' + icon('search', 16) + '<input type="search" id="addSongSearch" placeholder="Поиск по названию, автору, тегу…" aria-label="Поиск песен"></div>' +
    '<div class="chip-row mb-2"><label class="chip"><input type="checkbox" id="onlyFav">Только избранные</label>' +
    (State.groups.length ? '<select class="form-select" id="addSongGroup" style="width:auto"><option value="">Все группы</option>' + State.groups.map(g => '<option value="' + g.id + '"' + (sl.groupId === g.id ? ' selected' : '') + '>' + escapeHtml(g.name) + '</option>').join('') + '</select>' : '') + '</div>' +
    '<div id="addSongList" style="max-height:44vh;overflow-y:auto"></div>',
    '<button class="btn" type="button" data-modal-close>Готово</button>', {
    onMount() {
      const render = () => {
        const q = ($('#addSongSearch').value || '').toLowerCase().trim();
        const fav = $('#onlyFav').checked;
        const gs = $('#addSongGroup');
        const gid = gs ? gs.value : '';
        const inList = {}; (sl.items || []).forEach(i => { inList[i.songId] = true; });
        let songs = State.songs.filter(s => !inList[s.id]);
        if (fav) songs = songs.filter(s => s.favorite);
        if (gid) songs = songs.filter(s => (s.groupIds || []).indexOf(gid) >= 0);
        if (q) songs = songs.filter(s => (s.title || '').toLowerCase().indexOf(q) >= 0 || (s.author || '').toLowerCase().indexOf(q) >= 0 || (s.artist || '').toLowerCase().indexOf(q) >= 0 || (s.tags || []).some(t => String(t).toLowerCase().indexOf(q) >= 0));
        songs.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
        $('#addSongList').innerHTML = songs.length ? songs.map(s =>
          '<div class="search-result-item" role="button" tabindex="0" data-add="' + s.id + '"><span class="search-result-icon">🎵</span>' +
          '<div style="flex:1;min-width:0"><div class="search-result-title">' + escapeHtml(s.title) + '</div>' +
          '<div class="search-result-meta">' + escapeHtml([s.key, s.bpm ? s.bpm + ' BPM' : '', s.artist || s.author].filter(Boolean).join(' · ') || '—') + '</div></div>' +
          '<span class="badge badge-accent">' + icon('plus', 14) + '</span></div>').join('')
          : '<p class="text-muted text-center" style="padding:20px">Все песни уже добавлены или ничего не найдено</p>';
        $$('[data-add]').forEach(row => {
          const go = async () => {
            const song = findSong(row.getAttribute('data-add')); if (!song) return;
            sl.items = sl.items || [];
            sl.items.push({ id: uid('si'), songId: song.id, position: sl.items.length, keyOverride: null, bpmOverride: null, notes: '', transition: '', leadMemberId: null });
            await saveSetlist(sl);
            Toast.success('«' + song.title + '» добавлена');
            renderSetlistItems(sl);
            render();
          };
          row.addEventListener('click', go);
          row.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
        });
      };
      render();
      $('#addSongSearch').addEventListener('input', debounce(render, 160), { passive: true });
      $('#onlyFav').addEventListener('change', render, { passive: true });
      const gs = $('#addSongGroup'); if (gs) gs.addEventListener('change', render, { passive: true });
    } });
}
async function removeSetlistItem(slId, itemId) {
  const sl = findSetlist(slId); if (!sl) return;
  const i = (sl.items || []).findIndex(x => x.id === itemId);
  if (i < 0) return;
  const removed = sl.items[i];
  sl.items.splice(i, 1);
  await saveSetlist(sl);
  renderSetlistItems(sl);
  Toast.success('Песня убрана из сет-листа', { label: 'Вернуть', fn: async () => { sl.items.splice(i, 0, removed); await saveSetlist(sl); renderSetlistItems(sl); } });
}
function editSetlistItem(slId, itemId) {
  const sl = findSetlist(slId); if (!sl) return;
  const it = (sl.items || []).find(x => x.id === itemId); if (!it) return;
  const s = findSong(it.songId);
  if (!s) { Toast.error('Песня недоступна'); return; }
  Modal.show('Параметры песни в сет-листе',
    '<div class="info-row"><span class="info-label">Песня</span><span class="info-value">' + escapeHtml(s.title) + '</span></div>' +
    '<div class="form-row"><div class="form-group"><label class="form-label" for="itKey">Тональность (оригинал: ' + escapeHtml(s.key || '—') + ')</label>' +
      '<input class="form-input" id="itKey" type="text" placeholder="Оставить оригинал" value="' + escapeHtml(it.keyOverride || '') + '"></div>' +
    '<div class="form-group"><label class="form-label" for="itBpm">BPM (оригинал: ' + (s.bpm || '—') + ')</label>' +
      '<input class="form-input" id="itBpm" type="number" min="20" max="400" inputmode="numeric" placeholder="Оставить оригинал" value="' + (it.bpmOverride || '') + '"></div></div>' +
    '<div class="form-group"><label class="form-label" for="itLead">Ответственный / ведущий вокалист</label><select class="form-select" id="itLead"><option value="">—</option>' +
      State.members.map(m => '<option value="' + m.id + '"' + (it.leadMemberId === m.id ? ' selected' : '') + '>' + escapeHtml(m.name + (m.roles && m.roles.length ? ' · ' + m.roles.join(', ') : '')) + '</option>').join('') + '</select></div>' +
    '<div class="form-group"><label class="form-label" for="itTrans">Переход / вступление / финал</label>' +
      '<input class="form-input" id="itTrans" type="text" placeholder="Например: вступление 8 тактов, переход без паузы" value="' + escapeHtml(it.transition || '') + '"></div>' +
    '<div class="form-group"><label class="form-label" for="itNotes">Заметка к песне</label>' +
      '<input class="form-input" id="itNotes" type="text" placeholder="Технические пометки" value="' + escapeHtml(it.notes || '') + '"></div>' +
    '<div class="form-error" id="itError" role="alert" hidden></div>',
    '<button class="btn" type="button" data-act="sl-remove" data-sl="' + sl.id + '" data-item="' + it.id + '" data-modal-close>Убрать</button>' +
    '<button class="btn" type="button" data-modal-close>Отмена</button><button class="btn btn-primary" type="button" id="saveItemBtn">Сохранить</button>',
    { onMount() {
        $('#saveItemBtn').addEventListener('click', async () => {
          const er = $('#itError'), k = $('#itKey').value.trim(), b = $('#itBpm').value.trim();
          if (k && !/^[A-G][#b]?/.test(k)) { er.textContent = 'Тональность должна начинаться с ноты A–G'; er.hidden = false; return; }
          if (b && (isNaN(parseInt(b, 10)) || parseInt(b, 10) < 20 || parseInt(b, 10) > 400)) { er.textContent = 'BPM: 20–400'; er.hidden = false; return; }
          it.keyOverride = k || null;
          it.bpmOverride = b ? parseInt(b, 10) : null;
          it.leadMemberId = $('#itLead').value || null;
          it.transition = $('#itTrans').value.trim();
          it.notes = $('#itNotes').value.trim();
          await saveSetlist(sl);
          Modal.close();
          Toast.success('Параметры обновлены');
          renderSetlistItems(sl);
        });
      } });
}
async function setSetlistStatus(slId, status) {
  const sl = findSetlist(slId); if (!sl) return;
  sl.status = status;
  await saveSetlist(sl);
  await logActivity('setlist', 'Сет-лист «' + sl.name + '» → ' + SETLIST_STATUS[status], sl.id);
  Toast.success('Статус: ' + SETLIST_STATUS[status]);
  renderSetlistDetail(slId);
}
async function duplicateSetlist(id) {
  const sl = findSetlist(id); if (!sl) return;
  const c = JSON.parse(JSON.stringify(sl));
  c.id = uid('set'); c.name = sl.name + ' (копия)'; c.status = 'draft';
  c.createdAt = nowISO(); c.updatedAt = nowISO();
  (c.items || []).forEach(i => { i.id = uid('si'); });
  await saveSetlist(c);
  await logActivity('setlist', 'Создана копия сет-листа «' + sl.name + '»', c.id);
  Toast.success('Копия создана');
  navigate('#/band/setlist/' + c.id);
}
function confirmDeleteSetlist(id) {
  const sl = findSetlist(id); if (!sl) return;
  Modal.confirm('Удалить сет-лист?', '«' + sl.name + '» будет удалён. Привязанные события останутся, но без программы.', async () => {
    const copy = JSON.parse(JSON.stringify(sl));
    await deleteSetlist(id);
    await logActivity('setlist', 'Удалён сет-лист «' + sl.name + '»', id);
    Toast.success('Сет-лист удалён', { label: 'Вернуть', fn: async () => { await saveSetlist(copy); navigate('#/band/setlist/' + copy.id); } });
    navigate('#/band');
  }, 'Удалить', true);
}
function createSetlistForEvent(eventId) {
  const e = findEvent(eventId); if (!e) return;
  Modal.show('Сет-лист для «' + e.title + '»',
    '<div class="form-group"><label class="form-label" for="qslName">Название</label>' +
    '<input class="form-input" id="qslName" type="text" value="' + escapeHtml(e.title + ' — ' + formatDateShort(e.start)) + '"></div>' +
    '<div class="form-group"><span class="form-label">Добавить песни (необязательно)</span><div style="max-height:200px;overflow-y:auto" id="qslSongs">' +
    (State.songs.length ? State.songs.map(s => '<label class="chip" style="display:flex;margin-bottom:4px"><input type="checkbox" value="' + s.id + '">' + escapeHtml(s.title) + '</label>').join('') : '<p class="form-hint">Каталог пуст — песни можно добавить позже.</p>') + '</div></div>',
    '<button class="btn" type="button" data-modal-close>Отмена</button><button class="btn btn-primary" type="button" id="qslSave">Создать и привязать</button>',
    { onMount() {
        $('#qslSave').addEventListener('click', async () => {
          const name = $('#qslName').value.trim();
          if (!name) { $('#qslName').classList.add('error'); $('#qslName').focus(); return; }
          const picked = $$('#qslSongs input:checked').map(c => c.value);
          const sl = { id: uid('set'), name, groupId: e.groupId || null, status: 'draft',
            items: picked.map((sid, i) => ({ id: uid('si'), songId: sid, position: i, keyOverride: null, bpmOverride: null, notes: '', transition: '', leadMemberId: null })),
            notes: '', createdAt: nowISO(), updatedAt: nowISO() };
          await saveSetlist(sl);
          e.setlistId = sl.id; await saveEvent(e);
          await logActivity('setlist', 'Создан сет-лист «' + name + '» для «' + e.title + '»', sl.id);
          Modal.close();
          Toast.success('Сет-лист создан и привязан к событию');
          navigate('#/band/setlist/' + sl.id);
        });
      } });
}
/* — Group detail page — */
function renderGroupDetail(id) {
  const g = findGroup(id);
  if (!g) { Toast.error('Группа не найдена'); navigate('#/band'); return; }
  const members = State.members.filter(m => (m.groupIds || []).indexOf(id) >= 0);
  const songs = State.songs.filter(s => (s.groupIds || []).indexOf(id) >= 0);
  const evts = State.events.filter(e => e.groupId === id).sort((a, b) => new Date(b.start) - new Date(a.start));
  const upcoming = evts.filter(e => new Date(e.start) >= new Date()).slice(0, 5);
  const past = evts.filter(e => new Date(e.start) < new Date()).slice(0, 8);
  const sls = State.setlists.filter(s => s.groupId === id);
  $('#content').innerHTML =
    '<div class="page-header"><div>' +
      '<button class="btn btn-sm mb-2" data-go="#/band">' + icon('arrowLeft', 16) + 'К группам</button>' +
      '<h1 class="page-title">' + escapeHtml(g.name) + (g.status === 'archived' ? ' <span class="badge badge-warning">Архив</span>' : '') + '</h1>' +
      '<p class="page-subtitle">' + escapeHtml([g.leader ? 'Лидер: ' + g.leader : null, members.length + ' ' + plural(members.length, 'участник', 'участника', 'участников'), songs.length + ' ' + plural(songs.length, 'песня', 'песни', 'песен'), g.inviteCode ? 'Код: ' + g.inviteCode : null].filter(Boolean).join(' · ')) + '</p>' +
    '</div><div class="page-actions">' +
      '<button class="btn" type="button" data-act="new-event-group" data-id="' + g.id + '">' + icon('calendar', 16) + 'Событие</button>' +
      '<button class="btn" type="button" data-act="new-setlist-group" data-id="' + g.id + '">' + icon('list', 16) + 'Сет-лист</button>' +
      '<button class="btn" type="button" data-act="' + (g.status === 'archived' ? 'unarchive-group' : 'archive-group') + '" data-id="' + g.id + '">' + icon('archive', 16) + (g.status === 'archived' ? 'Из архива' : 'В архив') + '</button>' +
      '<button class="btn btn-primary" type="button" data-act="edit-group" data-id="' + g.id + '">' + icon('edit', 16) + 'Изменить</button>' +
    '</div></div>' +
    '<div style="height:5px;background:' + escapeHtml(g.color || 'var(--accent)') + ';border-radius:3px;margin-bottom:16px"></div>' +
    (g.description ? '<section class="card mb-4"><h2 class="section-title">Описание</h2><p style="font-size:14px;color:var(--text-muted);line-height:1.7;white-space:pre-wrap">' + escapeHtml(g.description) + '</p></section>' : '') +
    '<section class="card mb-4"><div class="flex items-center justify-between flex-wrap gap-2">' +
      '<h2 class="section-title" style="margin:0">Участники и роли</h2>' +
      '<button class="btn btn-sm" type="button" data-act="new-member">' + icon('plus', 15) + 'Участник</button></div>' +
      (members.length ? '<div class="grid grid-2 mt-2">' + members.map(m =>
        '<div class="member-card" data-member="' + m.id + '" role="button" tabindex="0">' +
        '<div class="member-avatar" style="background:' + escapeHtml(m.color || 'var(--accent)') + '">' + escapeHtml((m.name || '?')[0].toUpperCase()) + '</div>' +
        '<div class="member-info"><div class="member-name">' + escapeHtml(m.name) + '</div>' +
        '<div class="member-roles">' + ((m.roles || []).map(r => '<span class="role-tag" style="background:' + hexToRgba(ROLE_COLORS[r] || '#9ca3af', 0.16) + ';color:' + (ROLE_COLORS[r] || '#9ca3af') + '">' + escapeHtml(r) + '</span>').join('') || '—') + '</div></div>' +
        '<span class="badge ' + (m.status === 'active' ? 'badge-success' : 'badge-muted') + '">' + MEMBER_STATUS[m.status || 'active'] + '</span></div>').join('') + '</div>'
        : '<p class="text-muted mt-2" style="font-size:14px">В группе пока нет участников.</p>') +
    '</section>' +
    '<section class="card mb-4"><div class="flex items-center justify-between flex-wrap gap-2">' +
      '<h2 class="section-title" style="margin:0">Песни группы (' + songs.length + ')</h2>' +
      '<button class="btn btn-sm" type="button" data-act="group-assign-songs" data-id="' + g.id + '">' + icon('plus', 15) + 'Назначить песни</button></div>' +
      (songs.length ? '<div class="chip-row mt-2">' + songs.slice(0, 40).map(s =>
        '<span class="song-badge" style="font-size:12px;padding:6px 10px"><a href="#/songs/' + s.id + '" style="color:inherit">' + escapeHtml(s.title) + '</a> ' +
        '<button type="button" data-act="group-unassign-song" data-id="' + g.id + '" data-val="' + s.id + '" aria-label="Убрать" style="color:inherit;opacity:.6">✕</button></span>').join('') + '</div>'
        : '<p class="text-muted mt-2" style="font-size:14px">Песни не назначены.</p>') +
    '</section>' +
    '<section class="card mb-4"><h2 class="section-title">Ближайшие репетиции и выступления</h2>' +
      (upcoming.length ? upcoming.map(e => occurrenceCardHTML({ ev: e, start: new Date(e.start), end: new Date(e.end || e.start), key: e.id, single: true }, true)).join('')
        : '<p class="text-muted" style="font-size:14px">Нет запланированных событий.</p>') + '</section>' +
    '<section class="card mb-4"><h2 class="section-title">Сет-листы группы</h2>' +
      (sls.length ? '<div class="grid grid-2">' + sls.map(sl => {
        const st = setlistStats(sl);
        return '<article class="song-card" data-sl="' + sl.id + '" role="link" tabindex="0"><div class="song-card-title">' + escapeHtml(sl.name) + '</div>' +
          '<div class="song-card-meta"><span>' + icon('music', 13) + ' ' + st.count + '</span><span>' + icon('clock', 13) + ' ' + durationLabel(st.duration) + '</span></div>' +
          '<div style="margin-top:8px"><span class="badge badge-muted">' + SETLIST_STATUS[sl.status || 'active'] + '</span></div></article>';
      }).join('') + '</div>' : '<p class="text-muted" style="font-size:14px">Сет-листов пока нет.</p>') + '</section>' +
    '<section class="card mb-4"><h2 class="section-title">История</h2>' +
      (past.length ? past.map(e => occurrenceCardHTML({ ev: e, start: new Date(e.start), end: new Date(e.end || e.start), key: e.id, single: true }, false)).join('')
        : '<p class="text-muted" style="font-size:14px">История появится после проведённых событий.</p>') + '</section>' +
    (g.notes ? '<section class="card mb-4"><h2 class="section-title">Заметки по группе</h2><p style="font-size:14px;color:var(--text-muted);white-space:pre-wrap">' + escapeHtml(g.notes) + '</p></section>' : '') +
    '<div class="flex gap-2 flex-wrap"><button class="btn btn-danger" type="button" data-act="delete-group" data-id="' + g.id + '">' + icon('trash', 16) + 'Удалить группу</button></div>';
}
function openGroupEditor(prefill) {
  prefill = prefill || {};
  const g = prefill.id ? findGroup(prefill.id) : null;
  const isEdit = !!g;
  const body =
    '<div class="form-group"><label class="form-label" for="grpName">Название *</label>' +
      '<input class="form-input" id="grpName" type="text" maxlength="80" placeholder="Например: Worship Team" value="' + (g ? escapeHtml(g.name) : '') + '"></div>' +
    '<div class="form-group"><label class="form-label" for="grpDesc">Описание</label>' +
      '<textarea class="form-textarea" id="grpDesc" style="min-height:70px;font-family:var(--font);font-size:14px" placeholder="Направление, состав, задачи коллектива">' + (g ? escapeHtml(g.description || '') : '') + '</textarea></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="grpLeader">Лидер / руководитель</label><input class="form-input" id="grpLeader" type="text" placeholder="Имя" value="' + (g ? escapeHtml(g.leader || '') : '') + '"></div>' +
      '<div class="form-group"><label class="form-label" for="grpColor">Цвет в календаре</label><input class="form-input" id="grpColor" type="color" style="height:48px;padding:6px" value="' + escapeHtml(g && g.color ? g.color : State.settings.accent) + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="grpInvite">Код приглашения</label><input class="form-input" id="grpInvite" type="text" maxlength="16" placeholder="WT2026" value="' + (g ? escapeHtml(g.inviteCode || '') : '') + '"></div>' +
      '<div class="form-group"><label class="form-label" for="grpStatus">Статус группы</label><select class="form-select" id="grpStatus">' +
        '<option value="active"' + (!g || g.status === 'active' ? ' selected' : '') + '>Активна</option>' +
        '<option value="archived"' + (g && g.status === 'archived' ? ' selected' : '') + '>Архивирована</option></select></div>' +
    '</div>' +
    '<div class="form-group"><span class="form-label">Участники группы</span><div class="chip-row" id="grpMembers">' +
      (State.members.length ? State.members.map(m => {
        const on = g ? (m.groupIds || []).indexOf(g.id) >= 0 : false;
        return '<label class="chip' + (on ? ' active' : '') + '"><input type="checkbox" value="' + m.id + '"' + (on ? ' checked' : '') + '>' + escapeHtml(m.name) + '</label>';
      }).join('') : '<p class="form-hint">Сначала добавьте участников.</p>') + '</div></div>' +
    '<div class="form-group"><label class="form-label" for="grpNotes">Заметки по группе</label>' +
      '<textarea class="form-textarea" id="grpNotes" style="min-height:64px;font-family:var(--font);font-size:14px" placeholder="Договорённости, техника, контакты площадки">' + (g ? escapeHtml(g.notes || '') : '') + '</textarea></div>' +
    (isEdit ? '<div class="form-group"><span class="form-label">Логотип / обложка</span>' +
      (g.logoFileId ? '<div class="file-list"><div class="file-row"><span class="f-ico">🖼️</span><span class="f-name">' + escapeHtml((fileMetaById(g.logoFileId) || {}).name || 'Логотип') + '</span>' +
        '<button class="btn btn-sm" type="button" data-act="open-file" data-id="' + g.logoFileId + '">Открыть</button>' +
        '<button class="btn btn-sm btn-danger" type="button" data-act="group-remove-logo" data-id="' + g.id + '">Удалить</button></div></div>'
        : '<button class="btn btn-sm" type="button" data-act="attach-logo" data-id="' + g.id + '">' + icon('paperclip', 15) + ' Загрузить логотип</button>') + '</div>' : '') +
    '<div class="form-error" id="grpError" role="alert" hidden></div>';
  Modal.show(isEdit ? 'Редактировать группу' : 'Новая группа', body,
    '<button class="btn" type="button" data-modal-close>Отмена</button><button class="btn btn-primary" type="button" id="saveGroupBtn">' + (isEdit ? 'Сохранить' : 'Создать') + '</button>',
    { onMount() {
        $$('#grpMembers input').forEach(cb => cb.addEventListener('change', () => cb.closest('.chip').classList.toggle('active', cb.checked), { passive: true }));
        $('#saveGroupBtn').addEventListener('click', async () => {
          const name = $('#grpName').value.trim();
          if (!name) { const er = $('#grpError'); er.textContent = 'Введите название группы'; er.hidden = false; $('#grpName').classList.add('error'); $('#grpName').focus(); return; }
          const group = g ? Object.assign({}, g) : { id: uid('grp'), createdAt: nowISO(), songIds: [], logoFileId: null };
          group.name = name;
          group.description = $('#grpDesc').value.trim();
          group.leader = $('#grpLeader').value.trim();
          group.color = $('#grpColor').value || State.settings.accent;
          group.inviteCode = $('#grpInvite').value.trim().toUpperCase();
          group.status = $('#grpStatus').value;
          group.notes = $('#grpNotes').value.trim();
          await saveGroup(group);
          const ids = $$('#grpMembers input:checked').map(c => c.value);
          for (const m of State.members) {
            const has = (m.groupIds || []).indexOf(group.id) >= 0, want = ids.indexOf(m.id) >= 0;
            if (has !== want) { m.groupIds = want ? (m.groupIds || []).concat([group.id]) : (m.groupIds || []).filter(x => x !== group.id); await saveMember(m); }
          }
          await logActivity('group', (isEdit ? 'Обновлена группа «' : 'Создана группа «') + name + '»', group.id);
          Modal.close();
          Toast.success(isEdit ? 'Группа обновлена' : 'Группа создана');
          navigate('#/band/group/' + group.id);
        });
      } });
}
async function toggleGroupArchive(id) {
  const g = findGroup(id); if (!g) return;
  g.status = g.status === 'archived' ? 'active' : 'archived';
  await saveGroup(g);
  await logActivity('group', 'Группа «' + g.name + '» ' + (g.status === 'archived' ? 'архивирована' : 'возвращена из архива'), g.id);
  Toast.success(g.status === 'archived' ? 'Группа в архиве (данные сохранены)' : 'Группа снова активна');
  handleRoute();
}
function confirmDeleteGroup(id) {
  const g = findGroup(id); if (!g) return;
  Modal.confirm('Удалить группу?', '«' + g.name + '» будет удалена. События, сет-листы и песни останутся, но потеряют привязку к группе. Чтобы сохранить данные — используйте архивирование.', async () => {
    const copy = JSON.parse(JSON.stringify(g));
    if (g.logoFileId) await deleteFile(g.logoFileId);
    await deleteGroup(id);
    await logActivity('group', 'Удалена группа «' + g.name + '»', id);
    Toast.success('Группа удалена', { label: 'Вернуть', fn: async () => { await saveGroup(copy); navigate('#/band/group/' + copy.id); } });
    navigate('#/band');
  }, 'Удалить', true);
}
function groupAssignSongs(id) {
  const g = findGroup(id); if (!g) return;
  Modal.show('Песни группы «' + g.name + '»',
    '<div class="filter-search mb-2" style="max-width:none">' + icon('search', 16) + '<input type="search" id="gasSearch" placeholder="Поиск песен…" aria-label="Поиск"></div>' +
    '<div id="gasList" style="max-height:50vh;overflow-y:auto"></div>',
    '<button class="btn btn-primary" type="button" data-modal-close>Готово</button>', {
    onMount() {
      const render = () => {
        const q = ($('#gasSearch').value || '').toLowerCase();
        const list = State.songs.filter(s => !q || (s.title || '').toLowerCase().indexOf(q) >= 0 || (s.artist || '').toLowerCase().indexOf(q) >= 0);
        $('#gasList').innerHTML = list.length ? list.map(s => {
          const on = (s.groupIds || []).indexOf(g.id) >= 0;
          return '<label class="participant-row"><span class="p-name"><input type="checkbox" data-gs="' + s.id + '"' + (on ? ' checked' : '') + ' style="accent-color:var(--accent);width:17px;height:17px">' + escapeHtml(s.title) + '</span>' +
            '<span class="badge badge-muted">' + escapeHtml(s.key || '—') + '</span></label>';
        }).join('') : '<p class="text-muted text-center" style="padding:20px">Каталог пуст</p>';
        $$('[data-gs]').forEach(cb => cb.addEventListener('change', async () => {
          const s = findSong(cb.getAttribute('data-gs')); if (!s) return;
          s.groupIds = s.groupIds || [];
          if (cb.checked && s.groupIds.indexOf(g.id) < 0) s.groupIds.push(g.id);
          if (!cb.checked) s.groupIds = s.groupIds.filter(x => x !== g.id);
          await saveSong(s);
        }, { passive: true }));
      };
      render();
      $('#gasSearch').addEventListener('input', debounce(render, 170), { passive: true });
    } });
}
async function groupUnassignSong(gid, songId) {
  const s = findSong(songId); if (!s) return;
  s.groupIds = (s.groupIds || []).filter(x => x !== gid);
  await saveSong(s);
  Toast.success('Песня убрана из группы');
  handleRoute();
}
function openMemberEditor(prefill) {
  prefill = prefill || {};
  const m = prefill.id ? findMember(prefill.id) : null;
  const isEdit = !!m;
  const c = (m && m.contacts) || { phone: '', email: '', telegram: '', whatsapp: '' };
  const body =
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="memName">Имя *</label><input class="form-input" id="memName" type="text" maxlength="80" placeholder="Имя и фамилия" value="' + (m ? escapeHtml(m.name) : '') + '"></div>' +
      '<div class="form-group"><label class="form-label" for="memStatus">Статус</label><select class="form-select" id="memStatus">' +
        Object.keys(MEMBER_STATUS).map(k => '<option value="' + k + '"' + ((m ? m.status : 'active') === k ? ' selected' : '') + '>' + MEMBER_STATUS[k] + '</option>').join('') + '</select></div>' +
    '</div>' +
    '<div class="form-group"><span class="form-label">Роли и инструменты</span><div class="chip-row" id="memRoles">' +
      allRoles().map(r => { const on = m && (m.roles || []).indexOf(r) >= 0; return '<label class="chip' + (on ? ' active' : '') + '" style="border-left:3px solid ' + (ROLE_COLORS[r] || '#9ca3af') + '"><input type="checkbox" value="' + escapeHtml(r) + '"' + (on ? ' checked' : '') + '>' + escapeHtml(r) + '</label>'; }).join('') +
      '</div><button class="btn btn-sm mt-2" type="button" data-act="manage-roles">Управление ролями</button></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="memPhone">Телефон</label><input class="form-input" id="memPhone" type="tel" inputmode="tel" placeholder="+7 900 000-00-00" value="' + escapeHtml(c.phone || '') + '"></div>' +
      '<div class="form-group"><label class="form-label" for="memEmail">Email</label><input class="form-input" id="memEmail" type="email" inputmode="email" placeholder="name@mail.com" value="' + escapeHtml(c.email || '') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="memTg">Telegram</label><input class="form-input" id="memTg" type="text" placeholder="@nickname" value="' + escapeHtml(c.telegram || '') + '"></div>' +
      '<div class="form-group"><label class="form-label" for="memWa">WhatsApp</label><input class="form-input" id="memWa" type="text" placeholder="+79000000000" value="' + escapeHtml(c.whatsapp || '') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label" for="memColor">Цвет аватара</label><input class="form-input" id="memColor" type="color" style="height:48px;padding:6px" value="' + escapeHtml(m && m.color ? m.color : State.settings.accent) + '"></div>' +
      '<div class="form-group"><label class="form-label" for="memNote">Заметка</label><input class="form-input" id="memNote" type="text" placeholder="Например: свой инструмент" value="' + escapeHtml(m && m.note ? m.note : '') + '"></div>' +
    '</div>' +
    '<div class="form-group"><span class="form-label">Группы</span><div class="chip-row" id="memGroups">' +
      (State.groups.length ? State.groups.map(g => { const on = m && (m.groupIds || []).indexOf(g.id) >= 0; return '<label class="chip' + (on ? ' active' : '') + '" style="border-left:3px solid ' + escapeHtml(g.color || 'var(--accent)') + '"><input type="checkbox" value="' + g.id + '"' + (on ? ' checked' : '') + '>' + escapeHtml(g.name) + '</label>'; }).join('') : '<p class="form-hint">Группы ещё не созданы.</p>') + '</div></div>' +
    '<div class="form-error" id="memError" role="alert" hidden></div>';
  Modal.show(isEdit ? 'Редактировать участника' : 'Новый участник', body,
    (isEdit ? '<button class="btn btn-danger" type="button" data-act="delete-member" data-id="' + m.id + '" data-modal-close>' + icon('trash', 16) + '</button>' : '') +
    '<button class="btn" type="button" data-modal-close>Отмена</button><button class="btn btn-primary" type="button" id="saveMemberBtn">' + (isEdit ? 'Сохранить' : 'Добавить') + '</button>',
    { onMount() {
        $$('#memRoles input, #memGroups input').forEach(cb => cb.addEventListener('change', () => cb.closest('.chip').classList.toggle('active', cb.checked), { passive: true }));
        $('#saveMemberBtn').addEventListener('click', async () => {
          const name = $('#memName').value.trim();
          const er = $('#memError');
          if (!name) { er.textContent = 'Введите имя участника'; er.hidden = false; $('#memName').classList.add('error'); $('#memName').focus(); return; }
          const email = $('#memEmail').value.trim();
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { er.textContent = 'Некорректный email'; er.hidden = false; $('#memEmail').classList.add('error'); $('#memEmail').focus(); return; }
          const member = m ? Object.assign({}, m) : { id: uid('mem'), createdAt: nowISO() };
          member.name = name;
          member.status = $('#memStatus').value;
          member.roles = $$('#memRoles input:checked').map(x => x.value);
          member.groupIds = $$('#memGroups input:checked').map(x => x.value);
          member.contacts = { phone: $('#memPhone').value.trim(), email, telegram: $('#memTg').value.trim(), whatsapp: $('#memWa').value.trim() };
          member.color = $('#memColor').value || State.settings.accent;
          member.note = $('#memNote').value.trim();
          member.avatar = name[0].toUpperCase();
          await saveMember(member);
          await logActivity('member', (isEdit ? 'Обновлён участник «' : 'Добавлен участник «') + name + '»', member.id);
          Modal.close();
          Toast.success(isEdit ? 'Данные обновлены' : 'Участник добавлен');
          handleRoute();
        });
      } });
}
function confirmDeleteMember(id) {
  const m = findMember(id); if (!m) return;
  Modal.confirm('Удалить участника?', '«' + m.name + '» будет удалён из состава всех событий и групп.', async () => {
    const copy = JSON.parse(JSON.stringify(m));
    await deleteMember(id);
    await logActivity('member', 'Удалён участник «' + m.name + '»', id);
    Toast.success('Участник удалён', { label: 'Вернуть', fn: async () => { await saveMember(copy); handleRoute(); } });
    handleRoute();
  }, 'Удалить', true);
}
function manageRoles() {
  const list = State.settings.customRoles || [];
  Modal.show('Роли и инструменты',
    '<p class="form-hint">Базовые роли: ' + escapeHtml(BASE_ROLES.join(', ')) + '. Здесь можно добавить собственные роли — они появятся в карточках участников.</p>' +
    '<div class="chip-row mt-2" id="customRoles">' + (list.length ? list.map(r =>
      '<span class="chip active">' + escapeHtml(r) + ' <button type="button" data-rm="' + escapeHtml(r) + '" aria-label="Удалить роль" style="color:inherit">✕</button></span>').join('') : '<p class="text-muted" style="font-size:13px">Собственные роли не добавлены.</p>') + '</div>' +
    '<div class="form-row mt-4"><div class="form-group"><label class="form-label" for="newRole">Новая роль</label>' +
    '<input class="form-input" id="newRole" type="text" maxlength="30" placeholder="Например: Flute, Backing vocal"></div>' +
    '<div class="form-group" style="justify-content:flex-end"><label class="form-label">&nbsp;</label><button class="btn btn-sm btn-primary" type="button" id="addRoleBtn">Добавить</button></div></div>' +
    '<div class="form-error" id="roleError" role="alert" hidden></div>',
    '<button class="btn btn-primary" type="button" data-modal-close>Готово</button>', {
    onMount() {
      const rerender = () => {
        const l = State.settings.customRoles || [];
        $('#customRoles').innerHTML = l.length ? l.map(r => '<span class="chip active">' + escapeHtml(r) + ' <button type="button" data-rm="' + escapeHtml(r) + '" aria-label="Удалить" style="color:inherit">✕</button></span>').join('') : '<p class="text-muted" style="font-size:13px">Собственные роли не добавлены.</p>';
        bindRm();
      };
      const bindRm = () => {
        $$('[data-rm]').forEach(b => b.addEventListener('click', async () => {
          const r = b.getAttribute('data-rm');
          State.settings.customRoles = (State.settings.customRoles || []).filter(x => x !== r);
          persistSetting('customRoles', State.settings.customRoles);
          Toast.info('Роль «' + r + '» удалена из списка');
          rerender();
        }));
      };
      bindRm();
      $('#addRoleBtn').addEventListener('click', async () => {
        const inp = $('#newRole'), v = inp.value.trim();
        const er = $('#roleError');
        if (!v) { er.textContent = 'Введите название роли'; er.hidden = false; return; }
        if (allRoles().some(r => r.toLowerCase() === v.toLowerCase())) { er.textContent = 'Такая роль уже существует'; er.hidden = false; return; }
        er.hidden = true;
        State.settings.customRoles = (State.settings.customRoles || []).concat([v]);
        persistSetting('customRoles', State.settings.customRoles);
        inp.value = '';
        Toast.success('Роль «' + v + '» добавлена');
        rerender();
      });
    } });
}

/* ═══ SECTION 11: SCENE MODE ═══ */
const SPEEDS = [{ v: 0.5, l: 'Очень медленно' }, { v: 0.75, l: 'Медленно' }, { v: 1, l: 'Средне' }, { v: 1.5, l: 'Быстро' }, { v: 2, l: 'Очень быстро' }];
function renderScenePage() {
  const ready = State.setlists.filter(sl => (sl.items || []).length && (sl.status || 'active') !== 'archived');
  $('#content').innerHTML =
    '<div class="page-header"><div><button class="btn btn-sm mb-2" data-go="#/band">' + icon('arrowLeft', 16) + 'К сет-листам</button>' +
      '<h1 class="page-title">Сценический режим</h1><p class="page-subtitle">Полноэкранный текст с аккордами, автопрокруткой и транспонированием</p></div></div>' +
    (ready.length ? '<section class="card mb-4"><h2 class="section-title">Выберите сет-лист</h2><div class="grid grid-2">' +
      ready.map(sl => { const st = setlistStats(sl); return '<button class="quick-action" type="button" data-act="launch-scene" data-id="' + sl.id + '"><span class="quick-action-icon">📋</span>' +
        '<span style="min-width:0"><span class="quick-action-label">' + escapeHtml(sl.name) + '</span><span class="quick-action-sub">' + st.count + ' ' + plural(st.count, 'песня', 'песни', 'песен') + ' · ' + durationLabel(st.duration) + '</span></span></button>'; }).join('') + '</div></section>'
      : '<div class="card mb-4">' + emptyBlock('🎬', 'Нет готовых сет-листов', 'Сценический режим работает с сет-листом, в котором есть хотя бы одна песня.', 'new-setlist', 'Создать сет-лист') + '</div>') +
    '<section class="card mb-4"><h2 class="section-title">Быстрый запуск песни</h2>' +
      (State.songs.length ? '<div class="grid grid-2">' + State.songs.slice(0, 8).map(s => '<button class="quick-action" type="button" data-act="scene-from-song" data-id="' + s.id + '"><span class="quick-action-icon">🎵</span>' +
        '<span style="min-width:0"><span class="quick-action-label">' + escapeHtml(s.title) + '</span><span class="quick-action-sub">' + escapeHtml([s.key, s.bpm ? s.bpm + ' BPM' : ''].filter(Boolean).join(' · ') || '—') + '</span></span></button>').join('') + '</div>'
        : '<p class="text-muted" style="font-size:14px">Добавьте песни в каталог.</p>') + '</section>' +
    '<section class="card"><h2 class="section-title">Параметры сцены</h2>' +
      '<div class="info-row"><span class="info-label">Размер шрифта</span><span class="info-value"><span class="transpose-controls">' +
        '<button class="transpose-btn" type="button" data-act="scene-font" data-d="-2">−</button><span class="transpose-value" id="sceneFontVal">' + State.ui.scene.font + '</span>' +
        '<button class="transpose-btn" type="button" data-act="scene-font" data-d="2">+</button></span></span></div>' +
      '<div class="info-row"><span class="info-label">Скорость автопрокрутки</span><span class="info-value"><select class="form-select" id="sceneSpeedSel" style="width:auto">' +
        SPEEDS.map(s => '<option value="' + s.v + '"' + (State.ui.scene.speed === s.v ? ' selected' : '') + '>' + s.l + ' (' + s.v + '×)</option>').join('') + '</select></span></div>' +
      '<div class="info-row"><span class="info-label">Не гасить экран</span><span class="info-value" id="wakeStatus">—</span></div>' +
      '<p class="form-hint mt-2">Клавиши: ← → песни, Пробел — прокрутка, + − шрифт, ♭ ♯ транспонирование, Esc — выход. На телефоне: свайп влево/вправо, тап по тексту скрывает панели.</p></section>';
  const sel = $('#sceneSpeedSel');
  if (sel) sel.addEventListener('change', () => {
    State.ui.scene.speed = parseFloat(sel.value);
    persistSetting('autoscrollSpeed', State.ui.scene.speed);
    updateSceneSpeedLabel();
    Toast.info('Скорость: ' + (SPEEDS.find(s => s.v === State.ui.scene.speed) || {}).l);
  }, { passive: true });
  updateWakeStatus();
}
function updateWakeStatus() {
  const el = $('#wakeStatus'); if (!el) return;
  el.textContent = !('wakeLock' in navigator) ? 'не поддерживается браузером' : (State.ui.scene.wake ? 'активно' : 'доступно — включится на сцене');
}
function sceneItems() {
  if (State.ui.scene.setlistId) { const sl = findSetlist(State.ui.scene.setlistId); return sl ? (sl.items || []) : []; }
  if (State.ui.scene.singleSongId) return [{ id: 'single', songId: State.ui.scene.singleSongId, keyOverride: null, bpmOverride: null }];
  return [];
}
function launchScene(setlistId) {
  const sl = findSetlist(setlistId);
  if (!sl || !(sl.items || []).length) { Toast.warning('В сет-листе нет песен'); return; }
  Object.assign(State.ui.scene, { setlistId: sl.id, singleSongId: null, index: 0, transpose: 0, auto: false });
  openSceneOverlay();
}
function launchSceneFromSong(songId, auto) {
  const s = findSong(songId);
  if (!s) { Toast.error('Песня не найдена'); return; }
  Object.assign(State.ui.scene, { setlistId: null, singleSongId: songId, index: 0, transpose: State.ui.transpose || 0, auto: false });
  openSceneOverlay();
  if (auto) setTimeout(() => { if (!State.ui.scene.auto) toggleSceneAuto(); }, 400);
}
function launchSceneFromEvent(eventId) {
  const e = findEvent(eventId); if (!e) return;
  if (!e.setlistId) {
    Toast.warning('У события нет сет-листа');
    Modal.confirm('Сет-лист не назначен', 'Создать сет-лист для «' + e.title + '», добавить песни и запустить сцену?', () => createSetlistForEvent(e.id), 'Создать сет-лист');
    return;
  }
  launchScene(e.setlistId);
}
function openSceneOverlay() {
  const ov = $('#sceneOverlay');
  ov.classList.add('active'); ov.classList.remove('ui-hidden');
  document.body.style.overflow = 'hidden';
  renderSceneSong();
  requestWakeLock();
  if (ov.requestFullscreen) ov.requestFullscreen().catch(() => {});
  else if (ov.webkitRequestFullscreen) { try { ov.webkitRequestFullscreen(); } catch (e) {} }
}
function renderSceneSong() {
  const items = sceneItems();
  if (!items.length) { exitScene(); Toast.warning('Нет песен для отображения'); return; }
  State.ui.scene.index = clamp(State.ui.scene.index, 0, items.length - 1);
  const it = items[State.ui.scene.index];
  const song = findSong(it.songId);
  if (!song) { Toast.error('Песня недоступна'); sceneNext(); return; }
  const t = State.ui.scene.transpose;
  const key = it.keyOverride ? transposeKey(it.keyOverride, t) : (song.key ? transposeKey(song.key, t) : '');
  const bpm = it.bpmOverride || song.bpm;
  const lead = it.leadMemberId ? findMember(it.leadMemberId) : null;
  $('#sceneSongInfo').innerHTML = '<h2>' + escapeHtml(song.title) + '</h2><p>' +
    escapeHtml([key, bpm ? bpm + ' BPM' : '', lead ? '🎤 ' + lead.name : '', (State.ui.scene.index + 1) + ' / ' + items.length].filter(Boolean).join(' · ')) + '</p>';
  const lyr = $('#sceneLyrics');
  lyr.style.fontSize = State.ui.scene.font + 'px';
  lyr.innerHTML = renderLyrics(song.lyrics, t).replace(/^<div class="lyrics-view">/, '').replace(/<\/div>$/, '');
  lyr.scrollTop = 0;
  $('#scenePrev').disabled = State.ui.scene.index === 0;
  $('#sceneNext').disabled = State.ui.scene.index >= items.length - 1;
  $('#sceneTransVal').textContent = (t > 0 ? '+' : '') + t;
  updateSceneProgress(); updateSceneSpeedLabel();
  if (State.ui.scene.auto) restartSceneScroll();
}
const updateSceneProgress = throttleRAF(function () {
  const items = sceneItems(), bar = $('#sceneProgressBar');
  if (!bar || !items.length) return;
  const lyr = $('#sceneLyrics');
  const p = (lyr && lyr.scrollHeight > lyr.clientHeight) ? lyr.scrollTop / (lyr.scrollHeight - lyr.clientHeight) : 1;
  bar.style.width = clamp(((State.ui.scene.index + p) / items.length) * 100, 0, 100) + '%';
});
function updateSceneSpeedLabel() {
  const b = $('#sceneSpeed');
  if (b) b.textContent = (State.ui.scene.speed % 1 === 0 ? State.ui.scene.speed.toFixed(0) : State.ui.scene.speed.toFixed(2).replace(/0$/, '')) + '×';
}
function scenePrev() { if (State.ui.scene.index > 0) { State.ui.scene.index--; renderSceneSong(); } }
function sceneNext() { const it = sceneItems(); if (State.ui.scene.index < it.length - 1) { State.ui.scene.index++; renderSceneSong(); } else Toast.info('Это последняя песня'); }
function sceneFont(d) {
  State.ui.scene.font = clamp(State.ui.scene.font + d, 14, 60);
  $('#sceneLyrics').style.fontSize = State.ui.scene.font + 'px';
  persistSetting('sceneFontSize', State.ui.scene.font);
  const v = $('#sceneFontVal'); if (v) v.textContent = State.ui.scene.font;
}
function sceneTranspose(d) { State.ui.scene.transpose = clamp(State.ui.scene.transpose + d, -11, 11); renderSceneSong(); }
function toggleSceneAuto() {
  State.ui.scene.auto = !State.ui.scene.auto;
  const b = $('#sceneScroll');
  b.textContent = State.ui.scene.auto ? '⏸' : '▶';
  b.classList.toggle('active', State.ui.scene.auto);
  b.setAttribute('aria-label', State.ui.scene.auto ? 'Пауза автопрокрутки' : 'Автопрокрутка');
  if (State.ui.scene.auto) startSceneScroll(); else stopSceneScroll();
}
function startSceneScroll() {
  stopSceneScroll();
  const lyr = $('#sceneLyrics');
  const song = findSong((sceneItems()[State.ui.scene.index] || {}).songId);
  const bpm = song && song.bpm ? song.bpm : 0;
  const factor = bpm ? clamp(bpm / 80, 0.55, 1.9) : 1;
  const px = State.ui.scene.font * 0.55 * State.ui.scene.speed * factor;
  let last = performance.now();
  const step = now => {
    if (!State.ui.scene.auto) return;
    const dt = Math.min(0.12, (now - last) / 1000); last = now;
    lyr.scrollTop += px * dt;
    updateSceneProgress();
    if (lyr.scrollTop + lyr.clientHeight >= lyr.scrollHeight - 2) {
      State.ui.scene.auto = false;
      const b = $('#sceneScroll'); b.textContent = '▶'; b.classList.remove('active');
      Toast.info('Конец песни — прокрутка остановлена');
      return;
    }
    State.ui.scene.raf = requestAnimationFrame(step);
  };
  State.ui.scene.raf = requestAnimationFrame(step);
}
function restartSceneScroll() { stopSceneScroll(); startSceneScroll(); }
function stopSceneScroll() { if (State.ui.scene.raf) { cancelAnimationFrame(State.ui.scene.raf); State.ui.scene.raf = null; } }
function cycleSceneSpeed() {
  const v = SPEEDS.map(s => s.v);
  State.ui.scene.speed = v[(v.indexOf(State.ui.scene.speed) + 1) % v.length];
  persistSetting('autoscrollSpeed', State.ui.scene.speed);
  updateSceneSpeedLabel();
  const sel = $('#sceneSpeedSel'); if (sel) sel.value = String(State.ui.scene.speed);
  if (State.ui.scene.auto) restartSceneScroll();
  Toast.info('Скорость: ' + (SPEEDS.find(s => s.v === State.ui.scene.speed) || {}).l);
}
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) { updateWakeStatus(); return; }
  try {
    State.ui.scene.wake = await navigator.wakeLock.request('screen');
    State.ui.scene.wake.addEventListener('release', () => { State.ui.scene.wake = null; updateWakeStatus(); });
    updateWakeStatus();
  } catch (e) { State.ui.scene.wake = null; updateWakeStatus(); }
}
async function releaseWakeLock() { if (State.ui.scene.wake) { try { await State.ui.scene.wake.release(); } catch (e) {} State.ui.scene.wake = null; } updateWakeStatus(); }
function sceneFullscreen() {
  const ov = $('#sceneOverlay');
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (ov.requestFullscreen) ov.requestFullscreen().catch(() => Toast.info('Полноэкранный режим недоступен'));
    else if (ov.webkitRequestFullscreen) { try { ov.webkitRequestFullscreen(); } catch (e) {} }
    else Toast.info('Полноэкранный режим не поддерживается');
  } else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
}
function exitScene() {
  State.ui.scene.auto = false;
  stopSceneScroll(); releaseWakeLock();
  const ov = $('#sceneOverlay');
  ov.classList.remove('active', 'ui-hidden');
  document.body.style.overflow = '';
  const b = $('#sceneScroll'); if (b) { b.textContent = '▶'; b.classList.remove('active'); }
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
function setupSceneTouch() {
  const ov = $('#sceneOverlay');
  let sx = 0, sy = 0, st = 0, moved = false;
  ov.addEventListener('touchstart', e => { if (!ov.classList.contains('active')) return; const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); moved = false; }, { passive: true });
  ov.addEventListener('touchmove', e => { const t = e.touches[0]; if (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12) moved = true; }, { passive: true });
  ov.addEventListener('touchend', e => {
    if (!ov.classList.contains('active')) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) { if (dx > 0) scenePrev(); else sceneNext(); return; }
    if (!moved && Date.now() - st < 300 && t.target.closest && t.target.closest('.scene-lyrics')) ov.classList.toggle('ui-hidden');
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ov.classList.contains('active') && !State.ui.scene.wake) requestWakeLock(); });
}

/* ═══ SECTION 12: PRINT / PDF / EXPORT / IMPORT ═══ */
function songPrintHTML(song, idx, opts) {
  const o = opts || State.settings.print;
  const lines = String(song.lyrics || '').split('\n').map(l => {
    const sec = l.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec) return '<span class="p-section">' + escapeHtml(sec[1]) + '</span>';
    if (o.chords && isChordLine(l)) return escapeHtml(l).replace(/\S+/g, w => '<b>' + w + '</b>');
    if (isChordLine(l)) return '';
    return escapeHtml(l) || '&nbsp;';
  }).filter(x => x !== '').join('\n');
  const meta = [];
  if (o.key && song.key) meta.push('Тональность: ' + song.key);
  if (song.bpm) meta.push('BPM: ' + song.bpm);
  if (song.timeSignature) meta.push('Размер: ' + song.timeSignature);
  if (song.duration) meta.push('Время: ' + durationLabel(song.duration));
  if (song.artist || song.author) meta.push((song.artist ? 'Исполнитель: ' + song.artist : '') + (song.author ? ' · Автор: ' + song.author : ''));
  if (song.genre) meta.push('Жанр: ' + song.genre);
  return '<div class="print-page' + (o.pageBreak ? ' break' : '') + '" style="font-size:' + o.font + 'pt">' +
    '<h1>' + (o.numbering ? (idx + 1) + '. ' : '') + escapeHtml(song.title) + '</h1>' +
    (meta.length ? '<div class="p-meta">' + escapeHtml(meta.join(' · ')) + '</div>' : '') +
    '<div class="p-lyrics">' + lines + '</div>' +
    (o.notes && song.notes ? '<h2>Заметки</h2><p style="font-size:' + o.font + 'pt">' + escapeHtml(song.notes) + '</p>' : '') +
    '</div>';
}
function setlistPrintHTML(sl, mode) {
  const st = setlistStats(sl), g = findGroup(sl.groupId);
  const ev = State.events.find(e => e.setlistId === sl.id);
  const head = '<h1>' + escapeHtml(sl.name) + '</h1><div class="p-meta">' +
    escapeHtml([g ? 'Группа: ' + g.name : null, ev ? 'Событие: ' + ev.title + ', ' + formatDate(ev.start) + ' ' + formatTime(ev.start) : null,
      st.count + ' песен · ' + durationLabel(st.duration) + (st.avgBpm ? ' · ' + st.avgBpm + ' BPM' : ''), SETLIST_STATUS[sl.status || 'active']].filter(Boolean).join(' · ')) + '</div>';
  if (mode === 'short') {
    let rows = '';
    (sl.items || []).forEach((it, i) => {
      const s = findSong(it.songId); if (!s) return;
      const lead = it.leadMemberId ? findMember(it.leadMemberId) : null;
      rows += '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(s.title) + '</td><td>' + escapeHtml(it.keyOverride || s.key || '—') + '</td><td>' +
        (it.bpmOverride || s.bpm || '—') + '</td><td>' + durationLabel(s.duration) + '</td><td>' + escapeHtml(lead ? lead.name : '') + '</td>' +
        '<td>' + escapeHtml([it.transition, it.notes].filter(Boolean).join(' · ')) + '</td></tr>';
    });
    return '<div class="print-page">' + head + '<table><thead><tr><th>№</th><th>Песня</th><th>Тон.</th><th>BPM</th><th>Время</th><th>Ответственный</th><th>Переход / заметка</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (sl.notes ? '<h2>Общие заметки</h2><p style="white-space:pre-wrap">' + escapeHtml(sl.notes) + '</p>' : '') + '</div>';
  }
  let out = '<div class="print-page">' + head + (sl.notes ? '<p style="white-space:pre-wrap;margin-bottom:8px">' + escapeHtml(sl.notes) + '</p>' : '') + '</div>';
  (sl.items || []).forEach((it, i) => {
    const s = findSong(it.songId); if (!s) return;
    const clone = Object.assign({}, s);
    if (it.keyOverride) {
      const semis = semitoneDiff(s.key, it.keyOverride);
      clone.key = it.keyOverride;
      clone.lyrics = transposeLyricsText(s.lyrics, semis);
    }
    const lead = it.leadMemberId ? findMember(it.leadMemberId) : null;
    out += songPrintHTML(clone, i, Object.assign({}, State.settings.print, { numbering: true }));
    if (it.transition || it.notes || lead) {
      out = out.replace(/<\/div>$/, '<p style="font-size:10pt;color:#333">' + escapeHtml([lead ? 'Ответственный: ' + lead.name : '', it.transition ? 'Переход: ' + it.transition : '', it.notes ? 'Заметка: ' + it.notes : ''].filter(Boolean).join(' · ')) + '</p></div>');
    }
  });
  return out;
}
function semitoneDiff(from, to) {
  const a = parseChord(String(from || '').split(' ')[0]), b = parseChord(String(to || '').split(' ')[0]);
  if (!a || !b) return 0;
  let d = (b.rootIdx - a.rootIdx) % 12;
  if (d > 6) d -= 12; if (d < -6) d += 12;
  return d;
}
function openPrintDialog(payload) {
  const o = Object.assign({}, State.settings.print, payload.options || {});
  const build = () => payload.build(o);
  Modal.show('Предпросмотр печати',
    '<div class="form-group"><span class="form-label">Что печатать</span><div class="chip-row" id="printOpts">' +
      [['chords', 'Аккорды'], ['notes', 'Заметки'], ['key', 'Тональность'], ['numbering', 'Номера песен'], ['pageBreak', 'Разрыв страницы между песнями']].map(k =>
        '<label class="chip' + (o[k[0]] ? ' active' : '') + '"><input type="checkbox" data-opt="' + k[0] + '"' + (o[k[0]] ? ' checked' : '') + '>' + k[1] + '</label>').join('') + '</div></div>' +
    '<div class="form-row"><div class="form-group"><label class="form-label" for="printFont">Размер шрифта (pt)</label>' +
      '<input class="form-input" id="printFont" type="number" min="8" max="20" step="1" value="' + o.font + '"></div>' +
    '<div class="form-group"><label class="form-label" for="printTranspose">Транспонировать (полутонов)</label>' +
      '<input class="form-input" id="printTranspose" type="number" min="-11" max="11" step="1" value="' + (payload.transpose || 0) + '"></div></div>' +
    '<div class="print-preview" id="printPreview">' + build() + '</div>',
    '<button class="btn" type="button" data-modal-close>Отмена</button>' +
    '<button class="btn" type="button" id="printPdfBtn">' + icon('download', 16) + 'Сохранить PDF</button>' +
    '<button class="btn btn-primary" type="button" id="printNowBtn">' + icon('print', 16) + 'Печать</button>',
    { size: 'modal-xl', onMount() {
        const refresh = () => {
          const tr = parseInt($('#printTranspose').value, 10) || 0;
          $('#printPreview').innerHTML = payload.build({
            chords: $('[data-opt="chords"]').checked, notes: $('[data-opt="notes"]').checked,
            key: $('[data-opt="key"]').checked, numbering: $('[data-opt="numbering"]').checked,
            pageBreak: $('[data-opt="pageBreak"]').checked, font: parseInt($('#printFont').value, 10) || 12
          }, tr);
        };
        $$('#printOpts input').forEach(cb => cb.addEventListener('change', () => { cb.closest('.chip').classList.toggle('active', cb.checked); refresh(); }, { passive: true }));
        $('#printFont').addEventListener('input', debounce(refresh, 250), { passive: true });
        $('#printTranspose').addEventListener('input', debounce(refresh, 250), { passive: true });
        $('#printNowBtn').addEventListener('click', () => { doPrint($('#printPreview').innerHTML, false); });
        $('#printPdfBtn').addEventListener('click', () => { doPrint($('#printPreview').innerHTML, true); });
      } });
}
function doPrint(html, asPdf) {
  $('#printArea').innerHTML = html;
  Modal.close();
  if (asPdf) Toast.info('В диалоге печати выберите «Сохранить как PDF»', null, 6000);
  setTimeout(() => window.print(), 80);
}
function printSongs(songs, transpose) {
  openPrintDialog({
    transpose: transpose || 0,
    build: (o, tr) => songs.map((s, i) => {
      const c = Object.assign({}, s);
      if (tr) { c.key = transposeKey(s.key, tr); c.lyrics = transposeLyricsText(s.lyrics, tr); }
      return songPrintHTML(c, i, o);
    }).join('')
  });
}
function printSetlistDialog(id, mode) {
  const sl = findSetlist(id); if (!sl) return;
  openPrintDialog({ build: () => setlistPrintHTML(sl, mode) });
}
function buildBackup() {
  return {
    app: 'BandPlan', formatVersion: 3, exportedAt: nowISO(), deviceId: State.settings.deviceId,
    settings: State.settings, profile: State.profile,
    songs: State.songs, events: State.events, setlists: State.setlists, groups: State.groups,
    members: State.members, songVersions: State.songVersions,
    note: 'Вложения (файлы) в JSON-резервную копию не входят: они хранятся локально в IndexedDB устройства.'
  };
}
function exportAll() {
  if (downloadFile('bandplan-backup-' + toLocalDateInput(new Date()) + '.json', JSON.stringify(buildBackup(), null, 2))) {
    State.settings.lastBackup = nowISO();
    writePrefs({ lastBackup: State.settings.lastBackup });
    Toast.success('Резервная копия сохранена');
    if (State.ui.base === '/more') renderMore();
  } else Toast.error('Не удалось создать файл');
}
function importFromFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => { Toast.error('Не удалось прочитать файл'); input.value = ''; };
  reader.onload = () => {
    let data;
    try { data = JSON.parse(String(reader.result)); } catch (e) { Toast.error('Файл повреждён: это не корректный JSON'); input.value = ''; return; }
    if (!data || typeof data !== 'object' || !Array.isArray(data.songs) || !Array.isArray(data.events)) {
      Toast.error('Неверный формат: ожидался резервный файл BandPlan (songs, events)');
      input.value = ''; return;
    }
    showImportPreview(data, () => { input.value = ''; });
  };
  reader.readAsText(file);
}
function showImportPreview(data, done) {
  const c = { songs: (data.songs || []).length, events: (data.events || []).length, setlists: (data.setlists || []).length, groups: (data.groups || []).length, members: (data.members || []).length, versions: (data.songVersions || []).length };
  const dupS = (data.songs || []).filter(s => State.songs.some(x => x.id === s.id || (x.title === s.title && x.author === s.author))).length;
  const dupE = (data.events || []).filter(e => State.events.some(x => x.id === e.id)).length;
  const legacy = !data.formatVersion || data.formatVersion < 3;
  Modal.show('Проверка перед импортом',
    '<p style="font-size:14px;line-height:1.6">Файл: <strong>' + escapeHtml(data.exportedAt ? 'от ' + formatDate(data.exportedAt) : 'без даты') + '</strong>' + (data.formatVersion ? ' · формат v' + data.formatVersion : '') + '</p>' +
    (legacy ? '<p class="form-hint">Это резервная копия более старой версии. Данные будут автоматически преобразованы в текущий формат (миграция v1 → v3), повторения и напоминания будут пересчитаны.</p>' : '') +
    '<div class="preview-box">' + ['Песни:' + c.songs, 'События:' + c.events, 'Сет-листы:' + c.setlists, 'Группы:' + c.groups, 'Участники:' + c.members, 'Версии песен:' + c.versions].map(x => '<div>' + escapeHtml(x) + '</div>').join('') + '</div>' +
    (dupS || dupE ? '<p class="form-hint mt-2">Совпадений: песни — ' + dupS + ', события — ' + dupE + '. При объединении более свежие записи заменят старые.</p>' : '') +
    '<div class="form-group mt-2"><span class="form-label">Режим импорта</span>' +
      '<label class="chip active" style="margin-bottom:6px"><input type="radio" name="impMode" value="merge" checked>Объединить с текущими данными</label>' +
      '<label class="chip"><input type="radio" name="impMode" value="replace">Заменить все данные</label></div>' +
    '<div class="form-error" id="impError" role="alert" hidden></div>',
    '<button class="btn" type="button" data-modal-close>Отмена</button><button class="btn btn-primary" type="button" id="impConfirm">Импортировать</button>',
    { onMount() {
        $$('input[name="impMode"]').forEach(r => r.addEventListener('change', () => $$('input[name="impMode"]').forEach(x => x.closest('.chip').classList.toggle('active', x.checked)), { passive: true }));
        $('#impConfirm').addEventListener('click', async ev => {
          const btn = ev.currentTarget; btn.classList.add('loading');
          const mode = ($$('input[name="impMode"]').find(r => r.checked) || {}).value || 'merge';
          const backup = buildBackup();
          try {
            await applyImport(data, mode);
            Modal.close();
            await logActivity('system', 'Импорт данных (' + mode + '): ' + c.songs + ' песен, ' + c.events + ' событий');
            Toast.success('Импорт завершён', { label: 'Откатить', fn: async () => { await applyImport(backup, 'replace'); handleRoute(); Toast.info('Данные восстановлены до импорта'); } });
            handleRoute();
          } catch (err) {
            Logger.error('import', err);
            const e2 = $('#impError');
            if (e2) { e2.textContent = 'Импорт не завершён: ' + (err && err.message ? err.message : 'неизвестная ошибка') + '. Восстанавливаем предыдущие данные…'; e2.hidden = false; }
            try { await applyImport(backup, 'replace'); handleRoute(); } catch (e3) { Logger.error('rollback', e3); }
            btn.classList.remove('loading');
          }
          if (done) done();
        });
      } });
}
async function applyImport(data, mode) {
  if (mode === 'replace') {
    await Promise.all(['songs', 'events', 'setlists', 'groups', 'members', 'songVersions'].map(s => dbClear(s)));
    State.songs = []; State.events = []; State.setlists = []; State.groups = []; State.members = []; State.songVersions = [];
  }
  const upsert = async (arr, store, list, mig) => {
    for (const raw of (arr || [])) {
      if (!raw || typeof raw !== 'object' || !raw.id) continue;
      const rec = mig ? mig(JSON.parse(JSON.stringify(raw))) : raw;
      const i = list.findIndex(x => x.id === rec.id);
      if (i >= 0) { if (new Date(rec.updatedAt || 0).getTime() >= new Date(list[i].updatedAt || 0).getTime()) list[i] = rec; else continue; }
      else list.push(rec);
      await dbPut(store, rec);
    }
  };
  await upsert(data.groups, 'groups', State.groups, migrateGroup);
  await upsert(data.members, 'members', State.members, migrateMember);
  await upsert(data.songs, 'songs', State.songs, migrateSong);
  await upsert(data.setlists, 'setlists', State.setlists, migrateSetlist);
  await upsert(data.events, 'events', State.events, migrateEvent);
  for (const v of (data.songVersions || [])) if (v && v.id && !State.songVersions.some(x => x.id === v.id)) { State.songVersions.push(v); await dbPut('songVersions', v); }
  if (data.profile && mode === 'replace') { Object.assign(State.profile, data.profile); dbPut('meta', { id: 'profile', value: State.profile }); }
  rebuildIndex();
  await refreshAllReminders();
  queueChange('system', 'import', uid('imp'));
  State.notify();
}
function toCSV(rows) {
  return rows.map(r => r.map(c => { const v = String(c == null ? '' : c); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';')).join('\r\n');
}
function exportChooser() {
  Modal.sheet('Экспорт данных', [
    { icon: '🗂️', label: 'Резервная копия (JSON)', sub: 'Все данные приложения', run: () => exportAll() },
    { icon: '🎵', label: 'Все песни (TXT с аккордами)', sub: 'Для печати и рассылки', run: () => runExport('songs-txt') },
    { icon: '📊', label: 'Каталог песен (CSV)', sub: 'Таблица для Excel / Google Sheets', run: () => runExport('songs-csv') },
    { icon: '📅', label: 'Расписание событий (CSV)', sub: 'Включая повторения на 90 дней', run: () => runExport('events-csv') },
    { icon: '📋', label: 'Все сет-листы (CSV)', sub: 'Песни, тональности, ответственные', run: () => runExport('setlists-csv') }
  ]);
}
function runExport(kind) {
  const stamp = toLocalDateInput(new Date());
  if (kind === 'songs-txt') {
    if (!State.songs.length) return Toast.warning('Нет песен для экспорта');
    downloadFile('bandplan-songs-' + stamp + '.txt', State.songs.map(s => songToText(s, 0)).join('\n\n' + '═'.repeat(50) + '\n\n'), 'text/plain;charset=utf-8');
    return Toast.success('Экспортировано песен: ' + State.songs.length);
  }
  if (kind === 'songs-csv') {
    const rows = [['Название', 'Исполнитель', 'Автор', 'Тональность', 'BPM', 'Размер', 'Длительность (с)', 'Жанр', 'Язык', 'Теги', 'Группы', 'Избранное', 'Ссылка', 'Обновлено']];
    State.songs.forEach(s => rows.push([s.title, s.artist || '', s.author || '', s.key || '', s.bpm || '', s.timeSignature || '', s.duration || '', s.genre || '', s.language || '', (s.tags || []).join('|'), (s.groupIds || []).map(g => groupName(g)).join('|'), s.favorite ? 'да' : 'нет', s.link || '', s.updatedAt || '']));
    downloadFile('bandplan-songs-' + stamp + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
    return Toast.success('Каталог песен экспортирован');
  }
  if (kind === 'events-csv') {
    const rows = [['Дата', 'Начало', 'Конец', 'Название', 'Тип', 'Повтор', 'Место', 'Группа', 'Сет-лист', 'Моё участие', 'Участников', 'Напоминания', 'Статус']];
    const list = expandOccurrences(startOfDay(new Date()), new Date(Date.now() + 86400000 * 90));
    list.forEach(o => {
      const e = o.ev, sl = e.setlistId ? findSetlist(e.setlistId) : null;
      rows.push([formatDate(o.start), formatTime(o.start), formatTime(o.end), e.title, EVENT_TYPES[e.type] || '', REPEATS[e.repeat || 'none'], e.location || '', groupName(e.groupId), sl ? sl.name : '', e.myStatus ? MY_STATUS[e.myStatus] : '', (e.participants || []).length, (e.reminderOffsets || []).map(reminderLabel).join('|'), e.status || '']);
    });
    downloadFile('bandplan-events-' + stamp + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
    return Toast.success('Расписание экспортировано (' + list.length + ' вхождений)');
  }
  if (kind === 'setlists-csv') {
    const rows = [['Сет-лист', 'Статус', 'Группа', '№', 'Песня', 'Тональность', 'BPM', 'Ответственный', 'Переход', 'Заметка']];
    State.setlists.forEach(sl => (sl.items || []).forEach((it, i) => {
      const s = findSong(it.songId) || {}, lead = it.leadMemberId ? findMember(it.leadMemberId) : null;
      rows.push([sl.name, SETLIST_STATUS[sl.status || 'active'], groupName(sl.groupId), i + 1, s.title || '—', it.keyOverride || s.key || '', it.bpmOverride || s.bpm || '', lead ? lead.name : '', it.transition || '', it.notes || '']);
    }));
    downloadFile('bandplan-setlists-' + stamp + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
    return Toast.success('Сет-листы экспортированы');
  }
}
async function bulkExportSelection() {
  const ids = Array.from(State.ui.selection);
  const songs = ids.map(findSong).filter(Boolean);
  if (!songs.length) return Toast.warning('Выберите песни');
  Modal.sheet('Экспорт выбранных (' + songs.length + ')', [
    { icon: '📄', label: 'Текст с аккордами (TXT)', run: () => { downloadFile('bandplan-selected-' + toLocalDateInput(new Date()) + '.txt', songs.map(s => songToText(s, 0)).join('\n\n' + '═'.repeat(40) + '\n\n'), 'text/plain;charset=utf-8'); Toast.success('Экспортировано: ' + songs.length); } },
    { icon: '📊', label: 'Таблица (CSV)', run: () => {
        const rows = [['Название', 'Исполнитель', 'Тональность', 'BPM', 'Размер', 'Жанр', 'Длительность (с)']];
        songs.forEach(s => rows.push([s.title, s.artist || s.author || '', s.key || '', s.bpm || '', s.timeSignature || '', s.genre || '', s.duration || '']));
        downloadFile('bandplan-selected-' + toLocalDateInput(new Date()) + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
        Toast.success('CSV сохранён');
      } },
    { icon: '🗂️', label: 'Данные (JSON)', run: () => { downloadFile('bandplan-songs-selected.json', JSON.stringify({ app: 'BandPlan', formatVersion: 3, exportedAt: nowISO(), songs, events: [], setlists: [], groups: [], members: [] }, null, 2)); Toast.success('JSON сохранён'); } }
  ]);
}
async function bulkAddToSetlist() {
  const ids = Array.from(State.ui.selection);
  if (!ids.length) return Toast.warning('Выберите песни');
  if (!State.setlists.length) { Modal.confirm('Нет сет-листов', 'Создать сет-лист и добавить в него выбранные песни?', () => openSetlistEditor({}), 'Создать сет-лист'); return; }
  Modal.show('Добавить ' + ids.length + ' ' + plural(ids.length, 'песню', 'песни', 'песен') + ' в сет-лист',
    '<div class="form-group"><label class="form-label" for="bulkSl">Сет-лист</label><select class="form-select" id="bulkSl">' +
    State.setlists.map(s => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('') + '</select></div>',
    '<button class="btn" type="button" data-modal-close>Отмена</button><button class="btn btn-primary" type="button" id="bulkSlGo">Добавить</button>',
    { onMount() {
        $('#bulkSlGo').addEventListener('click', async () => {
          const sl = findSetlist($('#bulkSl').value); if (!sl) return;
          sl.items = sl.items || [];
          let added = 0;
          ids.forEach(id => { if (!sl.items.some(i => i.songId === id)) { sl.items.push({ id: uid('si'), songId: id, position: sl.items.length, keyOverride: null, bpmOverride: null, notes: '', transition: '', leadMemberId: null }); added++; } });
          await saveSetlist(sl);
          await logActivity('setlist', added + ' песен добавлено в «' + sl.name + '»', sl.id);
          Modal.close();
          State.ui.selection.clear();
          Toast.success('Добавлено: ' + added, { label: 'Открыть', fn: () => navigate('#/band/setlist/' + sl.id) });
          renderSongList(); renderSelectionBar();
        });
      } });
}
async function bulkAssignGroup() {
  const ids = Array.from(State.ui.selection);
  if (!ids.length) return Toast.warning('Выберите песни');
  if (!State.groups.length) { Toast.warning('Сначала создайте группу'); return; }
  Modal.show('Назначить песни группе',
    '<div class="form-group"><label class="form-label" for="bulkGr">Группа</label><select class="form-select" id="bulkGr">' +
    State.groups.map(g => '<option value="' + g.id + '">' + escapeHtml(g.name) + '</option>').join('') + '</select></div>' +
    '<label class="chip active"><input type="checkbox" id="bulkGrRemove">Убрать из остальных групп</label>',
    '<button class="btn" type="button" data-modal-close>Отмена</button><button class="btn btn-primary" type="button" id="bulkGrGo">Назначить</button>',
    { onMount() {
        $('#bulkGrGo').addEventListener('click', async () => {
          const gid = $('#bulkGr').value, only = $('#bulkGrRemove').checked;
          let n = 0;
          for (const id of ids) {
            const s = findSong(id); if (!s) continue;
            s.groupIds = only ? [gid] : Array.from(new Set((s.groupIds || []).concat([gid])));
            await saveSong(s); n++;
          }
          Modal.close();
          State.ui.selection.clear();
          Toast.success('Назначено песен: ' + n);
          renderSongList(); renderSelectionBar();
        });
      } });
}
async function bulkFavorite() {
  const ids = Array.from(State.ui.selection);
  if (!ids.length) return Toast.warning('Выберите песни');
  const allFav = ids.every(id => { const s = findSong(id); return s && s.favorite; });
  for (const id of ids) { const s = findSong(id); if (s) { s.favorite = !allFav; await saveSong(s); } }
  Toast.success(allFav ? 'Убрано из избранного: ' + ids.length : 'Добавлено в избранное: ' + ids.length);
  renderSongList();
}
function bulkDelete() {
  const ids = Array.from(State.ui.selection);
  if (!ids.length) return Toast.warning('Выберите песни');
  Modal.confirm('Удалить выбранные песни?', 'Будет удалено ' + ids.length + ' ' + plural(ids.length, 'песня', 'песни', 'песен') + ' из каталога и из всех сет-листов.', async () => {
    const copies = ids.map(findSong).filter(Boolean).map(s => JSON.parse(JSON.stringify(s)));
    for (const id of ids) await deleteSong(id);
    await logActivity('song', 'Массовое удаление: ' + ids.length + ' песен');
    State.ui.selection.clear();
    Toast.success('Удалено: ' + ids.length, { label: 'Вернуть', fn: async () => { for (const c of copies) await saveSong(c); Toast.info('Восстановлено'); handleRoute(); } });
    handleRoute();
  }, 'Удалить', true);
}

/* ═══ SECTION 13: MORE (SETTINGS HUB) ═══ */
function renderMore() {
  const s = State.settings;
  const pending = State.syncQueue.filter(q => !q.synced).length;
  $('#content').innerHTML =
    '<div class="page-header"><div><h1 class="page-title">Ещё</h1>' +
      '<p class="page-subtitle">Профиль, настройки приложения, персонализация, данные и установка</p></div></div>' +

    '<section class="card mb-4"><h2 class="section-title">Профиль</h2>' +
      '<div class="form-row"><div class="form-group"><label class="form-label" for="profName">Ваше имя</label>' +
        '<input class="form-input" id="profName" type="text" maxlength="80" placeholder="Имя" value="' + escapeHtml(State.profile.name || '') + '"></div>' +
      '<div class="form-group"><label class="form-label" for="profRole">Роль в группе</label>' +
        '<input class="form-input" id="profRole" type="text" maxlength="60" placeholder="Например: Keyboard" value="' + escapeHtml(State.profile.role || '') + '"></div></div>' +
      '<div class="form-group"><span class="form-label">Моё участие по умолчанию</span><div class="part-switch" id="profPart">' +
        ['yes', 'maybe', 'no'].map(k => '<button class="part-btn' + ((State.profile.defaultParticipation || 'yes') === k ? ' on' : '') + '" type="button" data-val="' + k + '">' + MY_STATUS[k] + '</button>').join('') + '</div></div>' +
      '<button class="btn btn-sm btn-primary mt-2" type="button" id="saveProfileBtn">Сохранить профиль</button>' +
    '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Оформление и персонализация</h2>' +
      '<div class="form-group"><span class="form-label">Тема</span><div class="flex gap-2 flex-wrap">' +
        '<button class="btn' + (!s.systemTheme && s.theme === 'light' ? ' btn-primary' : '') + '" type="button" data-act="set-theme" data-val="light">Светлая</button>' +
        '<button class="btn' + (!s.systemTheme && s.theme === 'dark' ? ' btn-primary' : '') + '" type="button" data-act="set-theme" data-val="dark">Тёмная</button>' +
        '<button class="btn' + (!s.systemTheme && s.theme === 'amoled' ? ' btn-primary' : '') + '" type="button" data-act="set-theme" data-val="amoled">AMOLED</button>' +
        '<button class="btn' + (s.systemTheme ? ' btn-primary' : '') + '" type="button" data-act="set-theme" data-val="system">Системная</button></div></div>' +
      '<div class="form-group mt-4"><span class="form-label">Акцентный цвет интерфейса</span><div class="chip-row" id="accentRow">' +
        ACCENTS.map(a => '<button class="accent-swatch' + (s.accent === a ? ' on' : '') + '" type="button" data-act="set-accent" data-val="' + a + '" style="background:' + a + '" aria-label="Цвет ' + a + '"></button>').join('') +
        '<label class="chip" style="gap:8px">Свой<input type="color" id="accentCustom" value="' + escapeHtml(s.accent) + '" style="width:32px;height:28px;border:none;background:none;padding:0" aria-label="Свой цвет"></label></div></div>' +
      '<div class="form-group mt-4"><label class="form-label" for="lyricsFont">Размер шрифта текстов песен: <b id="lyricsFontVal">' + s.lyricsFont + 'px</b></label>' +
        '<input class="range-input" id="lyricsFont" type="range" min="12" max="26" step="1" value="' + s.lyricsFont + '"></div>' +
      '<div class="form-group mt-2"><label class="form-label" for="sceneFontSet">Размер шрифта на сцене: <b id="sceneFontSetVal">' + s.sceneFontSize + 'px</b></label>' +
        '<input class="range-input" id="sceneFontSet" type="range" min="16" max="48" step="1" value="' + s.sceneFontSize + '"></div>' +
      '<div class="info-row"><span class="info-label">Формат аккордов</span><span class="info-value"><select class="form-select" id="chordFmt" style="width:auto">' +
        [['auto', 'Как в оригинале'], ['sharp', 'Диезы (C#, F#)'], ['flat', 'Бемоли (Db, Gb)']].map(o => '<option value="' + o[0] + '"' + (s.chordFormat === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></span></div>' +
      '<div class="info-row"><span class="info-label">Уменьшить анимацию</span><span class="info-value"><label class="chip' + (s.reducedMotion ? ' active' : '') + '"><input type="checkbox" id="setReduced"' + (s.reducedMotion ? ' checked' : '') + '>Reduced motion</label></span></div>' +
    '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Формат даты, времени и недели</h2>' +
      '<div class="info-row"><span class="info-label">Формат даты</span><span class="info-value"><select class="form-select" id="setDateFormat" style="width:auto">' +
        [['long', '5 марта 2026'], ['short', '5 мар. 26'], ['numeric', '05.03.2026']].map(o => '<option value="' + o[0] + '"' + (s.dateFormat === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></span></div>' +
      '<div class="info-row"><span class="info-label">Формат времени</span><span class="info-value"><select class="form-select" id="setTimeFormat" style="width:auto">' +
        [['24', '24 часа (18:30)'], ['12', '12 часов (6:30 PM)']].map(o => '<option value="' + o[0] + '"' + (String(s.timeFormat) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></span></div>' +
      '<div class="info-row"><span class="info-label">Первый день недели</span><span class="info-value"><select class="form-select" id="setWeekStart" style="width:auto">' +
        '<option value="1"' + (s.weekStart !== 0 ? ' selected' : '') + '>Понедельник</option><option value="0"' + (s.weekStart === 0 ? ' selected' : '') + '>Воскресенье</option></select></span></div>' +
      '<div class="info-row"><span class="info-label">Вид календаря по умолчанию</span><span class="info-value"><select class="form-select" id="setDefView" style="width:auto">' +
        [['month', 'Месяц'], ['week', 'Неделя'], ['day', 'День'], ['agenda', 'Список']].map(o => '<option value="' + o[0] + '"' + (s.defaultView === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></span></div>' +
    '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Уведомления и напоминания</h2>' +
      '<div class="info-row"><span class="info-label">Системные уведомления</span><span class="info-value" id="notifState">' +
        ('Notification' in window ? (Notification.permission === 'granted' ? '<span class="badge badge-success">Разрешены</span>' : Notification.permission === 'denied' ? '<span class="badge badge-danger">Запрешены браузером</span>' : '<button class="btn btn-sm" type="button" data-act="enable-notifications">Включить</button>') : '<span class="badge badge-muted">Не поддерживаются</span>') + '</span></div>' +
      '<div class="info-row"><span class="info-label">Проверять напоминания</span><span class="info-value"><label class="chip' + (s.notifications ? ' active' : '') + '"><input type="checkbox" id="setNotif"' + (s.notifications ? ' checked' : '') + '>Включено</label></span></div>' +
      '<div class="form-group mt-2"><span class="form-label">Напоминания по умолчанию для новых событий</span><div class="chip-row" id="defRems">' +
        REMINDER_OPTIONS.map(o => '<label class="chip' + ((s.reminderDefaults || []).indexOf(o.v) >= 0 ? ' active' : '') + '"><input type="checkbox" value="' + o.v + '"' + ((s.reminderDefaults || []).indexOf(o.v) >= 0 ? ' checked' : '') + '>' + o.l + '</label>').join('') + '</div></div>' +
      '<p class="form-hint mt-2">Активных напоминаний: ' + State.reminders.filter(r => !r.fired).length + '. Уведомления приходят, когда приложение открыто (в том числе как установленное PWA).</p>' +
      '<button class="btn btn-sm mt-2" type="button" data-act="test-notification">' + icon('bell', 15) + 'Проверить уведомление</button>' +
    '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Печать и PDF</h2>' +
      '<div class="form-group"><label class="form-label" for="printFontSet">Базовый размер шрифта: <b id="printFontVal">' + s.print.font + 'pt</b></label>' +
        '<input class="range-input" id="printFontSet" type="range" min="9" max="18" step="1" value="' + s.print.font + '"></div>' +
      '<div class="chip-row mt-2" id="printDefaults">' +
        [['chords', 'Аккорды'], ['notes', 'Заметки'], ['key', 'Тональность'], ['numbering', 'Нумерация'], ['pageBreak', 'Разрыв страницы']].map(k =>
          '<label class="chip' + (s.print[k[0]] ? ' active' : '') + '"><input type="checkbox" data-p="' + k[0] + '"' + (s.print[k[0]] ? ' checked' : '') + '>' + k[1] + '</label>').join('') + '</div>' +
      '<p class="form-hint mt-2">PDF создаётся системным диалогом печати: выберите «Сохранить как PDF». Каждая песня может начинаться с новой страницы.</p>' +
    '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Резервное копирование, импорт и экспорт</h2>' +
      '<div class="info-row"><span class="info-label">Последняя копия</span><span class="info-value">' + escapeHtml(s.lastBackup ? formatDate(s.lastBackup) + ' ' + formatTime(s.lastBackup) : 'не создавалась') + '</span></div>' +
      '<div class="flex gap-2 mt-2 flex-wrap">' +
        '<button class="btn" type="button" data-act="export">' + icon('download', 16) + 'Экспорт</button>' +
        '<button class="btn" type="button" data-act="backup-now">' + icon('copy', 16) + 'Создать копию</button>' +
        '<button class="btn" type="button" data-act="import">' + icon('upload', 16) + 'Импорт JSON</button>' +
      '</div>' +
      '<p class="form-hint mt-2">Резервная копия включает песни, события, сет-листы, группы, участников, версии и настройки. Вложения хранятся локально и в JSON не входят.</p>' +
    '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Хранилище и вложенные файлы</h2><div id="storageInfo">Оценка хранилища…</div>' +
      '<div id="filesList" class="mt-2"></div>' +
      '<button class="btn btn-sm mt-2" type="button" data-act="persist-storage">Запросить постоянное хранение</button>' +
    '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Аккаунт и синхронизация</h2>' +
      '<div class="info-row"><span class="info-label">Режим</span><span class="info-value">Offline-first · ' + (navigator.onLine ? 'сеть доступна' : 'нет сети') + '</span></div>' +
      '<div class="info-row"><span class="info-label">Хранилище</span><span class="info-value">' + (storageMode === 'indexeddb' ? 'IndexedDB (локально)' : 'Память сессии') + '</span></div>' +
      '<div class="info-row"><span class="info-label">Очередь синхронизации</span><span class="info-value">' + pending + ' ' + plural(pending, 'запись', 'записи', 'записей') + '</span></div>' +
      '<div class="info-row"><span class="info-label">Идентификатор устройства</span><span class="info-value" style="font-family:var(--font-mono);font-size:12px">' + escapeHtml(s.deviceId || '—') + '</span></div>' +
      '<p class="form-hint mt-2">Облачный сервер не подключён: все изменения сохраняются на устройстве и попадают в очередь синхронизации. Подключение Supabase / Firebase / REST выполняется отдельным модулем без изменения интерфейса.</p>' +
      '<button class="btn btn-sm mt-2" type="button" data-act="logout">Выйти из профиля</button>' +
    '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Установка как приложение</h2>' +
      '<div class="info-row"><span class="info-label">Статус</span><span class="info-value" id="installStatus">' + (isStandalone() ? 'Установлено' : (deferredPrompt ? 'Готово к установке' : detectPlatformHint())) + '</span></div>' +
      '<button class="btn btn-primary mt-2" type="button" data-act="install-app">Установить BandPlan</button>' +
      '<p class="form-hint mt-2">Иконка на главном экране телефона или в меню приложений компьютера, запуск в отдельном окне, полная работа без интернета.</p>' +
    '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Роли</h2>' +
      '<div class="chip-row mb-2">' + allRoles().map(r => '<span class="role-tag" style="background:' + hexToRgba(ROLE_COLORS[r] || '#9ca3af', 0.16) + ';color:' + (ROLE_COLORS[r] || '#9ca3af') + '">' + escapeHtml(r) + '</span>').join('') + '</div>' +
      '<button class="btn btn-sm" type="button" data-act="manage-roles">' + icon('edit', 15) + 'Управление ролями</button></section>' +

    '<section class="card mb-4"><h2 class="section-title">Данные приложения</h2>' +
      '<div class="grid grid-4 mb-4">' +
        miniStat(State.songs.length, 'Песен') + miniStat(State.events.length, 'Событий') + miniStat(State.setlists.length, 'Сет-листов') +
        miniStat(State.groups.length, 'Групп') + miniStat(State.members.length, 'Участников') + miniStat(State.fileMeta.length, 'Файлов') +
        miniStat(State.songVersions.length, 'Версий') + miniStat(State.reminders.filter(r => !r.fired).length, 'Напоминаний') + '</div>' +
      '<div class="flex gap-2 flex-wrap"><button class="btn" type="button" data-act="reset-demo">' + icon('refresh', 16) + 'Демо-данные</button>' +
      '<button class="btn btn-danger" type="button" data-act="clear-all">' + icon('trash', 16) + 'Очистить всё</button></div>' +
    '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Сценический режим</h2>' +
      '<p class="text-muted" style="font-size:14px;line-height:1.6;margin-bottom:12px">Полноэкранный режим для выступления: крупный текст, автопрокрутка по темпу, транспонирование, экран не гаснет.</p>' +
      '<button class="btn btn-primary" type="button" data-go="#/scene">' + icon('stage', 16) + 'Открыть сцену</button></section>' +

    '<section class="card mb-4"><h2 class="section-title">Горячие клавиши</h2>' +
      [['Ctrl / Cmd + K', 'Палитра команд и поиск'], ['N', 'Новая песня'], ['E', 'Новое событие'], ['S', 'Новый сет-лист'],
       ['G, затем C / S / B', 'Календарь / Песни / Сет-листы'], ['Ctrl / Cmd + S', 'Сохранить в открытом редакторе'], ['Esc', 'Закрыть окно или выйти со сцены'],
       ['← →', 'Сцена: песни · Календарь: навигация'], ['Пробел', 'Сцена: автопрокрутка'], ['+ / −', 'Сцена: размер шрифта'], ['?', 'Эта справка']]
        .map(r => hotkeyRow(r[0], r[1])).join('') + '</section>' +

    '<section class="card mb-4"><h2 class="section-title">Помощь и обратная связь</h2>' +
      '<div class="sheet-list">' +
        '<button class="sheet-item" type="button" data-act="show-help"><span class="si-icon">❓</span><span>Как пользоваться BandPlan<small>Основные сценарии: группа → песни → сет-лист → событие → сцена</small></span></button>' +
        '<a class="sheet-item" href="mailto:support@bandplan.app?subject=BandPlan%20—%20обратная%20связь"><span class="si-icon">✉️</span><span>Написать в поддержку<small>Опишите проблему — ответим на указанный адрес</small></span></a>' +
        '<button class="sheet-item" type="button" data-act="show-privacy"><span class="si-icon">🔒</span><span>Политика конфиденциальности<small>Где хранятся данные и кто имеет к ним доступ</small></span></button>' +
      '</div></section>' +

    '<section class="card"><h2 class="section-title">О приложении</h2>' +
      '<p style="font-size:14px;color:var(--text-muted);line-height:1.7"><strong>BandPlan</strong> — операционная система музыкального коллектива: календарь с напоминаниями и повторами, каталог песен с аккордами и транспонированием, сет-листы, группы, участники и роли, сценический режим, печать и PDF, резервные копии.</p>' +
      '<p class="form-hint mt-2">Версия 3.0 · 3 файла · IndexedDB · PWA · Русская локализация · Без внешних сервисов и передачи данных</p></section>';

  bindMoreControls();
  renderStorageInfo();
}
function miniStat(v, l) { return '<div class="stat-card"><div class="stat-value">' + v + '</div><div class="stat-label">' + escapeHtml(l) + '</div></div>'; }
function hotkeyRow(k, d) {
  return '<div class="info-row"><span class="info-label"><kbd style="font-family:var(--font);background:var(--surface-3);padding:2px 8px;border-radius:6px;box-shadow:var(--shadow-clay-inset)">' + escapeHtml(k) + '</kbd></span>' +
    '<span class="info-value" style="font-weight:500;color:var(--text-muted)">' + escapeHtml(d) + '</span></div>';
}
function bindMoreControls() {
  const bind = (sel, ev, fn, opts) => { const e = $(sel); if (e) e.addEventListener(ev, fn, opts || { passive: true }); };
  bind('#saveProfileBtn', 'click', async () => {
    const name = $('#profName').value.trim(), role = $('#profRole').value.trim();
    if (!name) { $('#profName').classList.add('error'); $('#profName').focus(); Toast.warning('Введите имя'); return; }
    State.profile.name = name; State.profile.role = role;
    await dbPut('meta', { id: 'profile', value: State.profile });
    Toast.success('Профиль сохранён');
  });
  $$('#profPart .part-btn').forEach(b => b.addEventListener('click', async () => {
    State.profile.defaultParticipation = b.getAttribute('data-val');
    $$('#profPart .part-btn').forEach(x => x.classList.toggle('on', x === b));
    await dbPut('meta', { id: 'profile', value: State.profile });
    Toast.info('Участие по умолчанию: ' + MY_STATUS[State.profile.defaultParticipation]);
  }));
  bind('#accentCustom', 'input', debounce(ev => { applyAccent(ev.target.value); $$('#accentRow .accent-swatch').forEach(x => x.classList.remove('on')); }, 200));
  bind('#lyricsFont', 'input', ev => {
    const v = parseInt(ev.target.value, 10);
    $('#lyricsFontVal').textContent = v + 'px';
    persistSetting('lyricsFont', v);
    document.documentElement.style.setProperty('--lyrics-font', v + 'px');
  });
  bind('#sceneFontSet', 'input', ev => {
    const v = parseInt(ev.target.value, 10);
    $('#sceneFontSetVal').textContent = v + 'px';
    persistSetting('sceneFontSize', v);
    State.ui.scene.font = v;
  });
  bind('#chordFmt', 'change', ev => { persistSetting('chordFormat', ev.target.value); handleRoute(); Toast.success('Формат аккордов обновлён'); });
  bind('#setReduced', 'change', ev => { persistSetting('reducedMotion', ev.target.checked); ev.target.closest('.chip').classList.toggle('active', ev.target.checked); applyReducedMotion(); });
  bind('#setDateFormat', 'change', ev => { persistSetting('dateFormat', ev.target.value); handleRoute(); });
  bind('#setTimeFormat', 'change', ev => { persistSetting('timeFormat', ev.target.value); handleRoute(); });
  bind('#setWeekStart', 'change', ev => { persistSetting('weekStart', parseInt(ev.target.value, 10)); handleRoute(); });
  bind('#setDefView', 'change', ev => { persistSetting('defaultView', ev.target.value); State.ui.calendarView = ev.target.value; Toast.success('Вид календаря по умолчанию обновлён'); });
  bind('#setNotif', 'change', ev => {
    persistSetting('notifications', ev.target.checked);
    ev.target.closest('.chip').classList.toggle('active', ev.target.checked);
    if (ev.target.checked) { checkReminders(); Toast.success('Напоминания включены'); } else Toast.info('Напоминания отключены');
  });
  $$('#defRems input').forEach(cb => cb.addEventListener('change', () => {
    const vals = $$('#defRems input:checked').map(x => parseInt(x.value, 10));
    persistSetting('reminderDefaults', vals);
    cb.closest('.chip').classList.toggle('active', cb.checked);
  }, { passive: true }));
  bind('#printFontSet', 'input', ev => {
    const v = parseInt(ev.target.value, 10);
    $('#printFontVal').textContent = v + 'pt';
    State.settings.print.font = v; writePrefs({ print: State.settings.print });
  });
  $$('#printDefaults input').forEach(cb => cb.addEventListener('change', () => {
    State.settings.print[cb.getAttribute('data-p')] = cb.checked;
    writePrefs({ print: State.settings.print });
    cb.closest('.chip').classList.toggle('active', cb.checked);
  }, { passive: true }));
  const imp = $('#importFile');
  if (imp) imp.addEventListener('change', () => importFromFile(imp), { passive: true });
}
async function renderStorageInfo() {
  const el = $('#storageInfo');
  const filesEl = $('#filesList');
  if (!el) return;
  let usageText = 'Оценка недоступна в этом браузере';
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      usageText = 'Занято ' + bytesLabel(est.usage || 0) + ' из ' + bytesLabel(est.quota || 0) + (navigator.storage.persisted ? ' · постоянное хранение включено' : '');
    } catch (e) { Logger.warn('estimate', e); }
  }
  const total = State.fileMeta.reduce((a, f) => a + (f.size || 0), 0);
  el.innerHTML = '<div class="info-row"><span class="info-label">Хранилище браузера</span><span class="info-value">' + escapeHtml(usageText) + '</span></div>' +
    '<div class="info-row"><span class="info-label">Вложений</span><span class="info-value">' + State.fileMeta.length + ' · ' + bytesLabel(total) + '</span></div>';
  if (filesEl) {
    filesEl.innerHTML = State.fileMeta.length ? '<div class="file-list">' + State.fileMeta.slice(0, 30).map(f => {
      const owner = f.ownerId ? (findSong(f.ownerId) ? findSong(f.ownerId).title : (findEvent(f.ownerId) ? findEvent(f.ownerId).title : (findGroup(f.ownerId) ? findGroup(f.ownerId).name : ''))) : '';
      return '<div class="file-row"><span class="f-ico">' + fileIcon(f.type) + '</span><span class="f-name">' + escapeHtml(f.name) + (owner ? ' <small class="text-muted">· ' + escapeHtml(owner) + '</small>' : '') + '</span>' +
        '<span class="f-size">' + bytesLabel(f.size) + '</span>' +
        '<button class="btn btn-sm" type="button" data-act="open-file" data-id="' + f.id + '">Открыть</button>' +
        '<button class="btn btn-sm btn-danger" type="button" data-act="delete-file" data-id="' + f.id + '" aria-label="Удалить">' + icon('trash', 15) + '</button></div>';
    }).join('') + (State.fileMeta.length > 30 ? '<p class="form-hint">Показаны первые 30 файлов из ' + State.fileMeta.length + '.</p>' : '') + '</div>'
      : '<p class="form-hint">Вложений нет.</p>';
  }
}
async function persistStorage() {
  if (!(navigator.storage && navigator.storage.persist)) { Toast.warning('Постоянное хранение не поддерживается этим браузером'); return; }
  try {
    const ok = await navigator.storage.persist();
    Toast[ok ? 'success' : 'info'](ok ? 'Постоянное хранение включено — данные защищены от автоматической очистки' : 'Браузер не выдал постоянное хранение. Делайте резервные копии.');
    renderStorageInfo();
  } catch (e) { Toast.error('Не удалось запросить постоянное хранение'); }
}
function showHelp() {
  Modal.show('Как пользоваться BandPlan',
    '<div class="preview-box" style="max-height:56vh">' +
    '<h2 style="font-size:15px;margin-bottom:6px">1. Создайте группу и участников</h2><p>«Сет-листы и группы» → Группы → Создать группу. Во вкладке «Участники» добавьте музыкантов, их роли (включая собственные) и контакты: телефон, email, Telegram, WhatsApp.</p>' +
    '<h2 style="font-size:15px;margin:12px 0 6px">2. Добавьте песни в каталог</h2><p>«Песни» → Песня. Вставьте текст, аккорды отдельной строкой над текстом, укажите тональность, BPM, размер, жанр, язык, теги, ссылку на оригинал и прикрепите файлы (PDF, фото, аудио).</p>' +
    '<h2 style="font-size:15px;margin:12px 0 6px">3. Назначьте песни группе</h2><p>В карточке группы → «Назначить песни» или в редакторе песни отметьте нужные группы.</p>' +
    '<h2 style="font-size:15px;margin:12px 0 6px">4. Создайте событие в календаре</h2><p>«Календарь» → Событие. Укажите тип, дату, время, место, группу, участников со статусами, напоминания (5–10–15–30 минут, час, день, неделя или своё значение) и повторение (каждую неделю, каждый месяц и т.д.).</p>' +
    '<h2 style="font-size:15px;margin:12px 0 6px">5. Соберите сет-лист</h2><p>«Сет-листы и группы» → Сет-листы. Добавьте песни, перетащите их в нужный порядок, задайте тональность и темп для конкретного выступления, ответственного и переход. Привяжите сет-лист к событию.</p>' +
    '<h2 style="font-size:15px;margin:12px 0 6px">6. Печать и PDF</h2><p>В песне → «Печать»: выберите, что печатать (аккорды, заметки, тональность, номера, разрыв страниц), посмотрите предпросмотр и отправьте на печать или «Сохранить как PDF». Можно выбрать несколько песен и напечатать сразу.</p>' +
    '<h2 style="font-size:15px;margin:12px 0 6px">7. Сцена</h2><p>Из сет-листа, песни или события → «Сцена»: полноэкранный крупный текст, автопрокрутка по темпу, транспонирование, экран не гаснет. На телефоне — свайпы.</p>' +
    '<h2 style="font-size:15px;margin:12px 0 6px">8. После мероприятия</h2><p>Отметьте сет-лист как «Проведённый» или «Архивный», событие останется в истории группы.</p>' +
    '</div>', '<button class="btn btn-primary" type="button" data-modal-close>Понятно</button>', { size: 'modal-lg' });
}
function showPrivacy() {
  Modal.show('Политика конфиденциальности',
    '<div class="preview-box" style="max-height:56vh">' +
    '<p><strong>Где хранятся данные.</strong> Все данные BandPlan (песни, тексты, аккорды, события, сет-листы, группы, участники, контакты, напоминания и вложенные файлы) хранятся локально на вашем устройстве в базе IndexedDB и в настройках браузера. Приложение не имеет собственного сервера.</p>' +
    '<p><strong>Передача данных.</strong> BandPlan не передаёт и не отправляет ваши данные третьим лицам. Данные покидают устройство только если вы сами выполняете экспорт файла или открываете внешнюю ссылку, указанную в карточке песни.</p>' +
    '<p><strong>Контакты участников.</strong> Телефоны, email и мессенджеры участников видны только на этом устройстве. Используйте их исключительно для организации репетиций и выступлений.</p>' +
    '<p><strong>Уведомления.</strong> Напоминания обрабатываются локально. Разрешение на уведомления запрашивается браузером и может быть отозвано в настройках сайта или в разделе «Ещё».</p>' +
    '<p><strong>Установка приложения.</strong> При установке как PWA браузер хранит данные приложения в своём профиле. Удаление приложения или очистка данных браузера удаляет локальную базу — используйте резервное копирование.</p>' +
    '<p><strong>Резервные копии.</strong> Экспорт JSON создаёт файл со всеми данными (кроме вложений). Храните его в безопасном месте. Импорт проверяет структуру файла и предлагает объединение или замену.</p>' +
    '<p><strong>Удаление данных.</strong> Раздел «Ещё» → «Очистить всё» удаляет данные безвозвратно. «Выйти из профиля» удаляет только имя профиля на этом устройстве.</p>' +
    '</div>', '<button class="btn btn-primary" type="button" data-modal-close>Закрыть</button>', { size: 'modal-lg' });
}
function showShortcuts() {
  Modal.show('Горячие клавиши',
    [['Ctrl / Cmd + K', 'Палитра команд и поиск'], ['N', 'Новая песня'], ['E', 'Новое событие'], ['S', 'Новый сет-лист'],
     ['G, затем C / S / B', 'Календарь / Песни / Сет-листы'], ['Ctrl / Cmd + S', 'Сохранить в редакторе'], ['Esc', 'Закрыть окно или выйти со сцены'],
     ['← →', 'Сцена: песни · Календарь: навигация'], ['Пробел', 'Сцена: автопрокрутка'], ['+ / −', 'Сцена: размер шрифта'], ['?', 'Эта справка']]
      .map(r => hotkeyRow(r[0], r[1])).join(''),
    '<button class="btn btn-primary" type="button" data-modal-close>Понятно</button>');
}
async function logoutProfile() {
  Modal.confirm('Выйти из профиля?', 'Имя профиля на этом устройстве будет удалено. Песни, события, сет-листы и группы останутся на месте.', async () => {
    State.profile = Object.assign({}, DEFAULT_PROFILE);
    await dbPut('meta', { id: 'profile', value: State.profile });
    Toast.success('Вы вышли из профиля');
    renderMore();
  }, 'Выйти');
}

/* ═══ SECTION 6/8: COMMAND PALETTE & GLOBAL SEARCH ═══ */
let cmdResults = [], cmdIdx = 0;
function baseCommands() {
  return [
    { label: 'Новое событие', icon: '📅', keys: 'E', run: () => openEventEditor() },
    { label: 'Новая песня', icon: '🎵', keys: 'N', run: () => openSongEditor() },
    { label: 'Новый сет-лист', icon: '📋', keys: 'S', run: () => openSetlistEditor() },
    { label: 'Новая группа', icon: '👥', run: () => openGroupEditor() },
    { label: 'Новый участник', icon: '🎤', run: () => openMemberEditor() },
    { label: 'Перейти: Календарь', icon: '🗓️', run: () => navigate('#/calendar') },
    { label: 'Перейти: Песни', icon: '🎼', run: () => navigate('#/songs') },
    { label: 'Перейти: Сет-листы и группы', icon: '📑', run: () => navigate('#/band') },
    { label: 'Перейти: Ещё (настройки)', icon: '⚙️', run: () => navigate('#/more') },
    { label: 'Сценический режим', icon: '🎬', run: () => navigate('#/scene') },
    { label: 'К сегодняшнему дню', icon: '📍', run: () => { State.ui.calendarDate = new Date(); navigate('#/calendar'); } },
    { label: 'Сменить тему', icon: '🎨', keys: 'T', run: () => toggleTheme() },
    { label: 'Управление ролями', icon: '🎭', run: () => manageRoles() },
    { label: 'Печать и PDF…', icon: '🖨️', run: () => { State.ui.selectMode = true; State.ui.selection.clear(); navigate('#/songs'); setTimeout(() => { renderSelectionBar(); Toast.info('Отметьте песни и нажмите «Печать / PDF»'); }, 120); } },
    { label: 'Экспорт данных…', icon: '📤', run: () => exportChooser() },
    { label: 'Импорт данных из JSON…', icon: '📥', run: () => triggerImport() },
    { label: 'Создать резервную копию', icon: '🗂️', run: () => exportAll() },
    { label: 'Установить приложение', icon: '📲', run: () => installApp() },
    { label: 'Помощь и сценарии работы', icon: '❓', run: showHelp },
    { label: 'Политика конфиденциальности', icon: '🔒', run: showPrivacy },
    { label: 'Горячие клавиши', icon: '⌨️', keys: '?', run: showShortcuts }
  ];
}
function triggerImport() {
  let i = $('#importFile');
  if (!i || State.ui.base !== '/more') { navigate('#/more'); setTimeout(() => { const x = $('#importFile'); if (x) x.click(); }, 300); return; }
  i.click();
}
function openCmdPalette() {
  $('#cmdPaletteOverlay').classList.add('active');
  const inp = $('#cmdInput'); inp.value = '';
  renderCmdResults('');
  setTimeout(() => inp.focus(), 40);
}
function closeCmdPalette() { $('#cmdPaletteOverlay').classList.remove('active'); const i = $('#cmdInput'); if (i) i.value = ''; }
function scoreMatch(label, q) {
  const l = label.toLowerCase();
  if (l === q) return 100;
  if (l.indexOf(q) === 0) return 80;
  if (l.indexOf(q) > 0) return 60;
  let i = 0, hits = 0;
  for (let j = 0; j < l.length; j++) if (l[j] === q[i]) { i++; hits++; if (i === q.length) break; }
  return i === q.length ? 30 + hits : 0;
}
function renderCmdResults(query) {
  const q = String(query || '').toLowerCase().trim();
  let list = baseCommands().filter(c => !q || scoreMatch(c.label, q) > 0);
  if (q) list.sort((a, b) => scoreMatch(b.label, q) - scoreMatch(a.label, q));
  const groups = [{ title: 'Команды', items: list.slice(0, 12) }];
  if (q) {
    const push = (title, items) => { if (items.length) groups.push({ title, items }); };
    push('Песни', State.songs.filter(s => (s.title || '').toLowerCase().indexOf(q) >= 0 || (s.artist || '').toLowerCase().indexOf(q) >= 0 || (s.author || '').toLowerCase().indexOf(q) >= 0)
      .slice(0, 6).map(s => ({ label: s.title, icon: '🎵', meta: [s.key, s.artist || s.author].filter(Boolean).join(' · '), run: () => navigate('#/songs/' + s.id) })));
    push('События', State.events.filter(e => (e.title || '').toLowerCase().indexOf(q) >= 0 || (e.location || '').toLowerCase().indexOf(q) >= 0)
      .slice(0, 6).map(e => ({ label: e.title, icon: '📅', meta: formatDateShort(e.start) + ' ' + formatTime(e.start), run: () => openEventDetails(e.id) })));
    push('Сет-листы', State.setlists.filter(s => s.name.toLowerCase().indexOf(q) >= 0)
      .slice(0, 5).map(s => ({ label: s.name, icon: '📋', meta: (s.items || []).length + ' песен', run: () => navigate('#/band/setlist/' + s.id) })));
    push('Группы', State.groups.filter(g => g.name.toLowerCase().indexOf(q) >= 0)
      .slice(0, 4).map(g => ({ label: g.name, icon: '👥', meta: 'Группа', run: () => navigate('#/band/group/' + g.id) })));
    push('Участники', State.members.filter(m => m.name.toLowerCase().indexOf(q) >= 0 || (m.roles || []).some(r => r.toLowerCase().indexOf(q) >= 0))
      .slice(0, 5).map(m => ({ label: m.name, icon: '👤', meta: (m.roles || []).join(', '), run: () => openMemberEditor({ id: m.id }) })));
  }
  cmdResults = []; let html = '';
  groups.forEach(g => {
    if (!g.items.length) return;
    html += '<div class="cmd-group-title">' + escapeHtml(g.title) + '</div>';
    g.items.forEach(c => {
      const i = cmdResults.length; cmdResults.push(c);
      html += '<div class="cmd-item' + (i === 0 ? ' selected' : '') + '" role="option" data-cmd="' + i + '" tabindex="-1"><span class="cmd-item-icon">' + c.icon + '</span>' +
        '<span class="cmd-item-label">' + escapeHtml(c.label) + (c.meta ? ' <span class="text-muted" style="font-size:12px">· ' + escapeHtml(c.meta) + '</span>' : '') + '</span>' +
        (c.keys ? '<span class="cmd-item-shortcut">' + escapeHtml(c.keys) + '</span>' : '') + '</div>';
    });
  });
  if (!cmdResults.length) html = '<p class="text-muted text-center" style="padding:24px">Ничего не найдено</p>';
  $('#cmdResults').innerHTML = html;
  cmdIdx = 0;
  $$('#cmdResults .cmd-item').forEach(it => {
    const i = parseInt(it.getAttribute('data-cmd'), 10);
    it.addEventListener('click', () => runCmd(i));
    it.addEventListener('mouseenter', () => { cmdIdx = i; highlightCmd(); });
  });
}
function highlightCmd() {
  $$('#cmdResults .cmd-item').forEach((it, i) => it.classList.toggle('selected', i === cmdIdx));
  const s = $('#cmdResults .cmd-item.selected');
  if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' });
}
function runCmd(i) {
  const c = cmdResults[i]; if (!c) return;
  closeCmdPalette();
  setTimeout(() => { try { c.run(); } catch (e) { Logger.error('cmd', e); Toast.error('Не удалось выполнить команду'); } }, 30);
}
let _searchCache = { q: null, html: null, actions: [] };
function closeSearchDropdown() { const d = $('#searchDropdown'); if (d) d.classList.remove('active'); }
function handleGlobalSearch(query) {
  const dd = $('#searchDropdown');
  const q = String(query || '').toLowerCase().trim();
  if (!dd) return;
  if (q.length < 2) { closeSearchDropdown(); return; }
  if (_searchCache.q === q && _searchCache.html) { dd.innerHTML = _searchCache.html; bindSearchResults(_searchCache.actions, dd); dd.classList.add('active'); return; }
  const sections = [];
  const add = (title, items) => { if (items.length) sections.push({ title, items }); };
  add('Песни', State.songs.filter(s => (s.title || '').toLowerCase().indexOf(q) >= 0 || (s.artist || '').toLowerCase().indexOf(q) >= 0 || (s.author || '').toLowerCase().indexOf(q) >= 0 || (s.tags || []).some(t => String(t).toLowerCase().indexOf(q) >= 0)).slice(0, 5)
    .map(s => ({ icon: '🎵', title: s.title, meta: [s.key, s.artist || s.author].filter(Boolean).join(' · '), run: () => navigate('#/songs/' + s.id) })));
  add('События', State.events.filter(e => (e.title || '').toLowerCase().indexOf(q) >= 0 || (e.location || '').toLowerCase().indexOf(q) >= 0).slice(0, 5)
    .map(e => ({ icon: '📅', title: e.title, meta: formatDateShort(e.start) + ' · ' + formatTime(e.start), run: () => openEventDetails(e.id) })));
  add('Сет-листы', State.setlists.filter(s => s.name.toLowerCase().indexOf(q) >= 0).slice(0, 4)
    .map(s => ({ icon: '📋', title: s.name, meta: (s.items || []).length + ' песен', run: () => navigate('#/band/setlist/' + s.id) })));
  add('Группы', State.groups.filter(g => g.name.toLowerCase().indexOf(q) >= 0).slice(0, 3)
    .map(g => ({ icon: '👥', title: g.name, meta: 'Группа', run: () => navigate('#/band/group/' + g.id) })));
  add('Участники', State.members.filter(m => m.name.toLowerCase().indexOf(q) >= 0 || (m.roles || []).some(r => r.toLowerCase().indexOf(q) >= 0)).slice(0, 4)
    .map(m => ({ icon: '👤', title: m.name, meta: (m.roles || []).join(', ') || '—', run: () => openMemberEditor({ id: m.id }) })));
  if (!sections.length) {
    dd.innerHTML = '<p class="text-muted text-center" style="padding:24px">Ничего не найдено по запросу «' + escapeHtml(q) + '»</p>';
    dd.classList.add('active');
    _searchCache = { q, html: dd.innerHTML, actions: [] };
    return;
  }
  let html = ''; const flat = [];
  sections.forEach(sec => {
    html += '<div class="search-section-title">' + escapeHtml(sec.title) + '</div>';
    sec.items.forEach(it => {
      const i = flat.length; flat.push(it);
      html += '<div class="search-result-item" role="option" data-sr="' + i + '" tabindex="0"><span class="search-result-icon">' + it.icon + '</span>' +
        '<div style="min-width:0"><div class="search-result-title">' + escapeHtml(it.title) + '</div><div class="search-result-meta">' + escapeHtml(it.meta || '') + '</div></div></div>';
    });
  });
  _searchCache = { q, html, actions: flat };
  dd.innerHTML = html;
  bindSearchResults(flat, dd);
  dd.classList.add('active');
}
function bindSearchResults(flat, dd) {
  $$('[data-sr]', dd).forEach(el => {
    const go = () => {
      const it = flat[parseInt(el.getAttribute('data-sr'), 10)];
      closeSearchDropdown();
      const inp = $('#globalSearch'); if (inp) inp.value = '';
      _searchCache = { q: null, html: null, actions: [] };
      if (it) it.run();
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
  });
}

/* ═══ FILES UI ═══ */
let pendingFileTarget = null;
function attachFile(kind, ownerId) {
  pendingFileTarget = { kind, ownerId };
  const inp = $('#fileInput');
  if (!inp) return;
  inp.accept = kind === 'logo' ? 'image/*' : '.pdf,.txt,.doc,.docx,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,image/*,audio/*,text/*,application/pdf';
  inp.value = '';
  inp.click();
}
async function handleFilesPicked(input) {
  const t = pendingFileTarget;
  const files = Array.prototype.slice.call(input.files || []);
  if (!t || !files.length) { input.value = ''; return; }
  const MAX = 15 * 1024 * 1024;
  let added = 0;
  for (const f of files) {
    if (f.size > MAX) { Toast.warning('Файл «' + f.name + '» больше 15 МБ и не добавлен'); continue; }
    const meta = await saveFile(f, t.kind, t.ownerId);
    if (t.kind === 'logo' && t.ownerId) {
      const g = findGroup(t.ownerId);
      if (g) { if (g.logoFileId) await deleteFile(g.logoFileId); g.logoFileId = meta.id; await saveGroup(g); }
    } else if (t.kind === 'song' && t.ownerId) {
      const s = findSong(t.ownerId);
      if (s) { s.fileIds = (s.fileIds || []).concat([meta.id]); await saveSong(s); }
    } else if (t.kind === 'event' && t.ownerId) {
      const e = findEvent(t.ownerId);
      if (e) { e.fileIds = (e.fileIds || []).concat([meta.id]); await saveEvent(e); }
    }
    added++;
  }
  pendingFileTarget = null;
  input.value = '';
  if (added) {
    Toast.success('Прикреплено файлов: ' + added);
    if (t.kind === 'song' && t.ownerId && Modal.isOpen() === false) renderSongDetail(t.ownerId);
    else if (t.kind === 'event' && t.ownerId && !Modal.isOpen()) openEventDetails(t.ownerId);
    else if (t.kind === 'logo' && t.ownerId) { Modal.close(); handleRoute(); }
    else if (State.ui.base === '/more') renderStorageInfo();
  }
}
async function removeFile(id) {
  const meta = fileMetaById(id);
  if (!meta) { Toast.error('Файл не найден'); return; }
  const ownerKind = meta.kind, ownerId = meta.ownerId;
  await deleteFile(id);
  Toast.success('Файл удалён');
  if (ownerKind === 'song' && ownerId && State.ui.parts[1] === ownerId) renderSongDetail(ownerId);
  else if (State.ui.base === '/more') renderStorageInfo();
  else handleRoute();
}

/* ═══ PWA ═══ */
function makeIconPNG(size, maskable) {
  try {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const pad = maskable ? size * 0.1 : 0, s = size - pad * 2, r = maskable ? 0 : s * 0.22;
    ctx.save(); ctx.translate(pad, pad);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, s, s, r);
    else { ctx.moveTo(r, 0); ctx.lineTo(s - r, 0); ctx.quadraticCurveTo(s, 0, s, r); ctx.lineTo(s, s - r); ctx.quadraticCurveTo(s, s, s - r, s); ctx.lineTo(r, s); ctx.quadraticCurveTo(0, s, 0, s - r); ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.closePath(); }
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, shadeColor(State.settings.accent, 0.22));
    g.addColorStop(1, shadeColor(State.settings.accent, -0.16));
    ctx.fillStyle = g; ctx.fill();
    const u = s / 64;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * u; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(26 * u, 44 * u); ctx.lineTo(26 * u, 20 * u); ctx.lineTo(44 * u, 17 * u); ctx.lineTo(44 * u, 41 * u); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(21 * u, 44 * u, 5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(39 * u, 41 * u, 5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return c.toDataURL('image/png');
  } catch (e) { Logger.warn('icon', e); return null; }
}
function buildManifest() {
  const fb = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='112' fill='%236366f1'/%3E%3Cpath d='M208 352V160l144-24v192' stroke='white' stroke-width='32' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='168' cy='352' r='40' fill='white'/%3E%3Ccircle cx='312' cy='328' r='40' fill='white'/%3E%3C/svg%3E";
  const i192 = makeIconPNG(192, false) || fb;
  const i512 = makeIconPNG(512, false) || fb;
  const iMask = makeIconPNG(512, true) || fb;
  const i180 = makeIconPNG(180, false);
  if (i180) { const a = $('#appleTouchIcon'); if (a) a.href = i180; }
  const i32 = makeIconPNG(64, false);
  if (i32) { const f = $('#appIcon'); if (f) f.href = i32; }
  const manifest = {
    name: 'BandPlan — Music Group OS', short_name: 'BandPlan',
    description: 'Календарь, песни с аккордами, сет-листы, группы и участники музыкального коллектива. Работает офлайн.',
    id: './', start_url: './', scope: './', display: 'standalone', display_override: ['standalone', 'minimal-ui'],
    orientation: 'any', background_color: '#e8eaf6', theme_color: State.settings.accent, lang: 'ru', dir: 'ltr',
    categories: ['music', 'productivity', 'utilities'],
    icons: [
      { src: i192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: i512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: iMask, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [
      { name: 'Календарь', url: './#/calendar' }, { name: 'Песни', url: './#/songs' },
      { name: 'Сет-листы', url: './#/band' }, { name: 'Сцена', url: './#/scene' }
    ]
  };
  try {
    const link = $('#appManifest');
    if (link) link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
  } catch (e) { Logger.warn('manifest', e); }
}
let deferredPrompt = null;
function isStandalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
function isIOS() { const ua = navigator.userAgent || ''; return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function detectPlatformHint() {
  if (isIOS()) return 'iOS: «Поделиться» → «На экран Домой»';
  if (/Android/i.test(navigator.userAgent || '')) return 'Android: меню браузера → «Установить приложение»';
  return 'Установка через меню браузера';
}
function showInstallBanner() {
  const b = $('#installBanner');
  if (!b || isStandalone() || State.settings.installDismissed) return;
  b.hidden = false; b.classList.add('active');
}
function hideInstallBanner() { const b = $('#installBanner'); if (b) { b.classList.remove('active'); b.hidden = true; } }
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', ev => {
    ev.preventDefault();
    deferredPrompt = ev;
    const b = $('#installBtn'); if (b) b.hidden = false;
    const s = $('#installSideBtn'); if (s) s.hidden = false;
    const st = $('#installStatus'); if (st) st.textContent = 'Готово к установке';
    showInstallBanner();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const b = $('#installBtn'); if (b) b.hidden = true;
    const s = $('#installSideBtn'); if (s) s.hidden = true;
    hideInstallBanner();
    Toast.success('BandPlan установлено на устройство');
    const st = $('#installStatus'); if (st) st.textContent = 'Установлено';
  });
  if (isStandalone()) { document.documentElement.classList.add('standalone'); hideInstallBanner(); }
  else if (isIOS()) setTimeout(showInstallBanner, 1400);
}
function installApp() {
  hideInstallBanner();
  if (deferredPrompt) {
    try {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(ch => {
        if (ch && ch.outcome === 'accepted') Toast.success('Установка запущена');
        else Toast.info('Установка отменена');
        deferredPrompt = null;
        const b = $('#installBtn'); if (b) b.hidden = true;
        const st = $('#installStatus'); if (st) st.textContent = detectPlatformHint();
      }).catch(() => { deferredPrompt = null; showInstallHelp(); });
    } catch (e) { deferredPrompt = null; showInstallHelp(); }
    return;
  }
  showInstallHelp();
}
function showInstallHelp() {
  Modal.show('Установка BandPlan',
    '<p style="font-size:14px;line-height:1.7;color:var(--text-muted)">Приложение устанавливается средствами браузера. Выберите вашу платформу:</p>' +
    '<div class="preview-box"><strong>📱 Android / Chrome</strong><br>Меню ⋮ → «Установить приложение» или «Добавить на главный экран». Иконка появится на рабочем столе.<br><br>' +
    '<strong>🍏 iPhone / iPad · Safari</strong><br>«Поделиться» (квадрат со стрелкой) → «На экран Домой» → «Добавить».<br><br>' +
    '<strong>💻 Windows / macOS / Linux · Chrome, Edge</strong><br>Значок установки в адресной строке или меню → «Установить BandPlan».<br><br>' +
    '<strong>ℹ️ Важно</strong><br>Для автоматической установки страница должна открываться по https:// или localhost. Все данные хранятся локально и доступны офлайн.</div>',
    '<button class="btn" type="button" data-modal-close>Закрыть</button><button class="btn btn-primary" type="button" id="installRetry">Попробовать снова</button>',
    { onMount() { const b = $('#installRetry'); if (b) b.addEventListener('click', () => { Modal.close(); installApp(); }); } });
}

/* ═══ DRAG HELPER (pointer events) ═══ */
function makeDraggable(el, opts) {
  let sx = 0, sy = 0, dragging = false;
  el.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (Modal.isOpen() || $('#cmdPaletteOverlay').classList.contains('active')) return;
    sx = ev.clientX; sy = ev.clientY; dragging = false;
    const pid = ev.pointerId;
    try { el.setPointerCapture(pid); } catch (e) {}
    const move = e2 => {
      const dx = e2.clientX - sx, dy = e2.clientY - sy;
      if (!dragging && Math.sqrt(dx * dx + dy * dy) < 6) return;
      if (!dragging) { dragging = true; if (opts.onStart) opts.onStart(e2, dx, dy); }
      if (e2.cancelable) e2.preventDefault();
      if (opts.onMove) opts.onMove(e2, dx, dy);
    };
    const up = e3 => {
      cleanup();
      if (dragging) { if (opts.onEnd) opts.onEnd(e3); } else if (opts.onTap) opts.onTap(e3);
      dragging = false;
    };
    const cancel = e4 => { cleanup(); if (dragging && opts.onEnd) opts.onEnd(e4); dragging = false; };
    const cleanup = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      try { el.releasePointerCapture(pid); } catch (e) {}
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  });
}

/* ═══ SECTION 16: DEMO DATA ═══ */
async function seedDemoData() {
  const g1 = { id: uid('grp'), name: 'Worship Team', description: 'Прославление на воскресных служениях и молодёжных вечерах', leader: 'Алексей Иванов', color: '#6366f1', inviteCode: 'WT2026', status: 'active', notes: 'Репетиции по вторникам, звук проверяем за час до служения.', logoFileId: null, createdAt: nowISO(), updatedAt: nowISO() };
  const g2 = { id: uid('grp'), name: 'Rock Band', description: 'Концертный состав для городских площадок', leader: 'Мария Петрова', color: '#ef4444', inviteCode: 'RB2026', status: 'active', notes: '', logoFileId: null, createdAt: nowISO(), updatedAt: nowISO() };
  await saveGroup(g1); await saveGroup(g2);
  const defs = [
    { name: 'Алексей Иванов', roles: ['Vocal', 'Guitar'], color: '#6366f1', contacts: { phone: '+7 900 111-22-33', email: 'alex@bandplan.app', telegram: '@alexey_iv', whatsapp: '+79001112233' } },
    { name: 'Мария Петрова', roles: ['Keys', 'Vocal'], color: '#ec4899', contacts: { phone: '+7 900 222-33-44', email: 'maria@bandplan.app', telegram: '@maria_p', whatsapp: '' } },
    { name: 'Дмитрий Сидоров', roles: ['Bass'], color: '#22c55e', contacts: { phone: '+7 900 333-44-55', email: '', telegram: '@dmitry_bass', whatsapp: '+79003334455' } },
    { name: 'Елена Смирнова', roles: ['Vocal'], color: '#f59e0b', contacts: { phone: '', email: 'elena@bandplan.app', telegram: '', whatsapp: '' } },
    { name: 'Сергей Кузнецов', roles: ['Drums'], color: '#8b5cf6', contacts: { phone: '+7 900 555-66-77', email: '', telegram: '@serg_drums', whatsapp: '' } },
    { name: 'Анна Волкова', roles: ['Strings', 'Vocal'], color: '#14b8a6', contacts: { phone: '', email: 'anna@bandplan.app', telegram: '@anna_v', whatsapp: '' } }
  ];
  const members = [];
  for (const d of defs) members.push(await saveMember({ id: uid('mem'), name: d.name, roles: d.roles, avatar: d.name[0], color: d.color, status: 'active', groupIds: [g1.id, g2.id], contacts: d.contacts, note: '', createdAt: nowISO(), updatedAt: nowISO() }));
  const songs = [
    { title: 'Amazing Grace', artist: 'Chris Tomlin', author: 'John Newton', key: 'G', bpm: 72, timeSignature: '4/4', duration: 240, genre: 'Worship', language: 'English', tags: ['classic', 'hymn'], favorite: true,
      lyrics: '[Verse 1]\nG          G7       C        G\nAmazing grace how sweet the sound\nG          G7     D        G\nThat saved a wretch like me\nG          G7       C        G\nI once was lost but now am found\nG          D7       C    G\nWas blind but now I see\n\n[Chorus]\nC          G          D\nMy chains are gone I\'ve been set free\nC          G          D\nMy God my Savior has ransomed me\nC          G          D    Em\nAnd like a flood His mercy reigns\nC          D          G\nUnending love amazing grace' },
    { title: 'How Great Thou Art', artist: 'Carrie Underwood', author: 'Carl Boberg', key: 'C', bpm: 60, timeSignature: '4/4', duration: 300, genre: 'Hymn', language: 'English', tags: ['hymn'], favorite: false,
      lyrics: '[Verse 1]\nC                F          C\nO Lord my God when I in awesome wonder\nG              C\nConsider all the worlds Thy hands have made\nC           F              C\nI see the stars I hear the rolling thunder\nG               C\nThy power throughout the universe displayed\n\n[Chorus]\nC    F      C        G    C\nThen sings my soul my Savior God to Thee\nG            C\nHow great Thou art how great Thou art' },
    { title: '10,000 Reasons', artist: 'Matt Redman', author: 'Matt Redman', key: 'D', bpm: 78, timeSignature: '4/4', duration: 280, genre: 'Worship', language: 'English', tags: ['modern'], favorite: true,
      lyrics: '[Verse 1]\nD        A        Bm    G\nBless the Lord O my soul\nD          A             G\nO my soul worship His holy name\nD         A        Bm    G\nSing like never before\nD        A           G\nO my soul I\'ll worship Your holy name\n\n[Chorus]\nG       D             A\nBless the Lord O my soul\nBm        A           G\nAnd all that is within me\nG          D         A\nBless His holy name' },
    { title: 'Way Maker', artist: 'Sinach', author: 'Osinachi Kalu', key: 'A', bpm: 70, timeSignature: '4/4', duration: 320, genre: 'Worship', language: 'English', tags: ['modern'], favorite: false,
      lyrics: '[Verse 1]\nA          E         Bm      D\nYou are here moving in our midst\nA          E         D\nI worship You I worship You\nA          E         Bm      D\nYou are here working in this place\nA          E         D\nI worship You I worship You\n\n[Chorus]\nD        A          E\nWay Maker miracle worker\nF#m        D\nPromise keeper light in the darkness\nA          E\nMy God that is who You are' },
    { title: 'Океаны', artist: 'Группа Worship RU', author: 'Перевод Hillsong', key: 'Dm', bpm: 68, timeSignature: '4/4', duration: 340, genre: 'Worship', language: 'Русский', tags: ['modern', 'ru'], favorite: true,
      lyrics: '[Verse 1]\nDm         Bb         F\nТы зовёшь меня на воды\nC          Dm\nГде ноги могут подвести\nDm         Bb         F\nИ там Тебя я встречу в тайне\nC\nВ глубинах вера будет жить\n\n[Chorus]\nBb         F          C\nВеди меня туда где вера без границ\nDm         C          Bb\nГде Ты позовёшь меня\nBb         F          C\nЯ пойду по водам куда Ты позовёшь' },
    { title: 'House Of The Lord', artist: 'Phil Wickham', author: 'Phil Wickham', key: 'E', bpm: 118, timeSignature: '4/4', duration: 250, genre: 'Rock', language: 'English', tags: ['praise', 'upbeat'], favorite: false,
      lyrics: '[Verse 1]\nE              B           C#m\nThere is joy in the house of the Lord\nE              B           A\nThere is joy in the house of the Lord today\n\n[Chorus]\nA          E          B\nWe won\'t be quiet\nC#m         B         A\nShout out Your praise' }
  ];
  for (const s of songs) {
    await saveSong({ id: uid('song'), artist: s.artist, author: s.author, title: s.title, key: s.key, bpm: s.bpm, timeSignature: s.timeSignature, duration: s.duration, genre: s.genre, language: s.language, tags: s.tags, favorite: s.favorite, lyrics: s.lyrics, notes: '', link: '', groupIds: [g1.id], fileIds: [], version: 1, createdAt: nowISO(), updatedAt: nowISO() });
  }
  const sl1 = { id: uid('set'), name: 'Sunday Worship Set', groupId: g1.id, status: 'active', notes: 'Вступление — инструментал 1 мин; между 3 и 4 песней переход без паузы.', items: [], createdAt: nowISO(), updatedAt: nowISO() };
  const sl2 = { id: uid('set'), name: 'Concert Set 2026', groupId: g2.id, status: 'draft', notes: 'Концертная программа, финал — общий акцент.', items: [], createdAt: nowISO(), updatedAt: nowISO() };
  await saveSetlist(sl1); await saveSetlist(sl2);
  sl1.items = State.songs.slice(0, 4).map((s, i) => ({ id: uid('si'), songId: s.id, position: i, keyOverride: i === 2 ? 'C' : null, bpmOverride: null, notes: i === 0 ? 'Начинаем тихо' : '', transition: i === 2 ? 'Без паузы в следующую' : '', leadMemberId: i % 2 === 0 ? members[0].id : members[1].id }));
  sl2.items = State.songs.slice(2, 6).map((s, i) => ({ id: uid('si'), songId: s.id, position: i, keyOverride: null, bpmOverride: null, notes: i === 1 ? 'Соло 8 тактов' : '', transition: '', leadMemberId: members[3].id }));
  await saveSetlist(sl1); await saveSetlist(sl2);
  const today = startOfDay(new Date());
  const mk = (off, h, m) => { const d = new Date(today); d.setDate(d.getDate() + off); d.setHours(h, m, 0, 0); return d; };
  const defsEv = [
    { title: 'Воскресное служение', type: 'worship', start: mk((7 - today.getDay()) % 7 || 7, 10, 0), dur: 7200000, location: 'Главный зал', groupId: g1.id, description: 'Служение прославления', status: 'confirmed', setlistId: sl1.id, parts: members.slice(0, 5).map((m, i) => ({ memberId: m.id, status: i === 4 ? 'pending' : 'confirmed' })), offs: [1440, 60, 15], repeat: 'weekly', until: null, myStatus: 'yes' },
    { title: 'Репетиция Worship Team', type: 'rehearsal', start: mk(2, 18, 30), dur: 9000000, location: 'Репетиционная база', groupId: g1.id, description: 'Разбор новых песен и сет-листа', status: 'confirmed', setlistId: sl1.id, parts: members.map(m => ({ memberId: m.id, status: 'confirmed' })), offs: [180], repeat: 'weekly', until: null, myStatus: 'yes' },
    { title: 'Концерт «Голоса»', type: 'concert', start: mk(9, 19, 0), dur: 10800000, location: 'ДК Культуры, ул. Ленина 12', groupId: g2.id, description: 'Благотворительный концерт', status: 'pending', setlistId: sl2.id, parts: members.map((m, i) => ({ memberId: m.id, status: i % 3 === 0 ? 'pending' : 'confirmed' })), offs: [10080, 1440, 60], repeat: 'none', until: null, myStatus: 'maybe' },
    { title: 'Планирование программы', type: 'meeting', start: mk(4, 14, 0), dur: 5400000, location: 'Офис', groupId: g1.id, description: 'План на следующий месяц', status: 'pending', setlistId: null, parts: [{ memberId: members[0].id, status: 'confirmed' }, { memberId: members[1].id, status: 'pending' }], offs: [1440], repeat: 'none', until: null, myStatus: 'yes' },
    { title: 'Акустический вечер', type: 'concert', start: mk(16, 18, 0), dur: 9000000, location: 'Антикафе «Лофт»', groupId: g2.id, description: 'Малый состав, 3 музыканта', status: 'pending', setlistId: null, parts: [], offs: [4320], repeat: 'none', until: null, myStatus: null },
    { title: 'Замена струн и настройка', type: 'personal', start: mk(1, 12, 0), dur: 3600000, location: 'Дом', groupId: null, description: 'Личное напоминание перед репетицией', status: 'confirmed', setlistId: null, parts: [], offs: [30], repeat: 'none', until: null, myStatus: 'yes' }
  ];
  for (const d of defsEv) {
    const end = new Date(d.start.getTime() + d.dur);
    await saveEvent({
      id: uid('evt'), title: d.title, type: d.type, start: d.start.toISOString(), end: end.toISOString(),
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone) || '', location: d.location, groupId: d.groupId,
      description: d.description, status: d.status, color: TYPE_COLORS[d.type], setlistId: d.setlistId,
      participants: d.parts, participantIds: d.parts.map(p => p.memberId), reminderOffsets: d.offs,
      repeat: d.repeat, repeatUntil: d.until, repeatInterval: 1, exdates: [], myStatus: d.myStatus, fileIds: [],
      createdAt: nowISO(), updatedAt: nowISO()
    });
  }
  rebuildIndex();
  await refreshAllReminders();
  await logActivity('system', 'Загружены демонстрационные данные');
}
function resetDemoData() {
  Modal.confirm('Загрузить демо-данные?', 'Текущие песни, события, сет-листы, группы и участники будут удалены и заменены демонстрационными. Рекомендуем сначала создать резервную копию.', async () => {
    for (const st of ['songs', 'events', 'setlists', 'groups', 'members', 'songVersions', 'reminders', 'activity']) await dbClear(st);
    State.songs = []; State.events = []; State.setlists = []; State.groups = []; State.members = [];
    State.songVersions = []; State.reminders = []; State.activity = [];
    await seedDemoData();
    Toast.success('Демо-данные загружены');
    handleRoute();
  }, 'Загрузить', true);
}
function clearAllData() {
  Modal.confirm('Очистить все данные?', 'Будут удалены все песни, события, сет-листы, группы, участники, версии и история. Действие необратимо — сначала создайте резервную копию.', async () => {
    for (const st of STORES) if (st !== 'meta') await dbClear(st);
    State.songs = []; State.events = []; State.setlists = []; State.groups = []; State.members = [];
    State.songVersions = []; State.reminders = []; State.activity = []; State.syncQueue = []; State.fileMeta = [];
    rebuildIndex();
    Toast.success('Все данные удалены');
    handleRoute();
  }, 'Очистить всё', true);
}

/* ═══ ONBOARDING ═══ */
function startOnboarding() {
  const steps = ['profile', 'group', 'theme', 'demo'];
  const step = { i: 0 };
  const render = () => {
    const cur = steps[step.i];
    let title = 'Добро пожаловать в BandPlan', body = '', footer = '';
    if (cur === 'profile') {
      title = 'Шаг 1 из 4 — Вы';
      body = '<p style="font-size:14px;color:var(--text-muted);line-height:1.6">BandPlan хранит всё на устройстве и работает без интернета. На мобильном устанавливается как обычное приложение.</p>' +
        '<div class="form-group"><label class="form-label" for="obName">Ваше имя</label><input class="form-input" id="obName" type="text" maxlength="60" placeholder="Например: Алексей"></div>' +
        '<div class="form-group"><label class="form-label" for="obRole">Ваша роль</label><input class="form-input" id="obRole" type="text" maxlength="60" placeholder="Например: Keyboard"></div>';
      footer = '<button class="btn" type="button" id="obSkip">Пропустить</button><button class="btn btn-primary" type="button" id="obNext">Дальше</button>';
    } else if (cur === 'group') {
      title = 'Шаг 2 из 4 — Ваш коллектив';
      body = '<div class="form-group"><label class="form-label" for="obGroup">Название группы</label><input class="form-input" id="obGroup" type="text" maxlength="60" placeholder="Например: Worship Team"></div>' +
        '<div class="form-group"><label class="form-label" for="obColor">Цвет группы в календаре</label><input class="form-input" id="obColor" type="color" style="height:48px;padding:6px" value="' + escapeHtml(State.settings.accent) + '"></div>';
      footer = '<button class="btn" type="button" id="obBack">Назад</button><button class="btn" type="button" id="obSkip">Пропустить</button><button class="btn btn-primary" type="button" id="obNext">Дальше</button>';
    } else if (cur === 'theme') {
      title = 'Шаг 3 из 4 — Оформление';
      body = '<p style="font-size:14px;color:var(--text-muted);margin-bottom:12px">Тему, акцентный цвет и размеры шрифтов можно изменить в разделе «Ещё».</p>' +
        '<div class="flex gap-2 flex-wrap">' + Object.keys(THEME_NAMES).concat(['system']).map(k =>
          '<button class="btn' + ((State.settings.systemTheme ? 'system' : State.settings.theme) === k ? ' btn-primary' : '') + '" type="button" data-ob-theme="' + k + '">' + (THEME_NAMES[k] || 'Системная') + '</button>').join('') + '</div>' +
        '<div class="chip-row mt-4" id="obAccents">' + ACCENTS.map(a => '<button class="accent-swatch' + (State.settings.accent === a ? ' on' : '') + '" type="button" data-ob-accent="' + a + '" style="background:' + a + '" aria-label="Акцент ' + a + '"></button>').join('') + '</div>';
      footer = '<button class="btn" type="button" id="obBack">Назад</button><button class="btn btn-primary" type="button" id="obNext">Дальше</button>';
    } else {
      title = 'Шаг 4 из 4 — Данные';
      body = '<p style="font-size:14px;color:var(--text-muted);line-height:1.6;margin-bottom:12px">Загрузить демонстрационные данные? 6 песен с аккордами, 2 группы, 6 участников с контактами, 6 событий (включая еженедельную репетицию) и 2 сет-листа. Демо можно удалить в разделе «Ещё».</p>' +
        '<div class="flex gap-2 flex-wrap"><button class="btn btn-primary" type="button" id="obDemoYes">🎵 Загрузить демо-данные</button>' +
        '<button class="btn" type="button" id="obDemoNo">Начать с чистого листа</button></div>';
      footer = '<button class="btn" type="button" id="obBack">Назад</button>';
    }
    Modal.show(title, body, footer, {
      onMount() {
        const next = $('#obNext'), back = $('#obBack'), skip = $('#obSkip');
        if (next) next.addEventListener('click', async () => {
          if (steps[step.i] === 'profile') {
            State.profile.name = ($('#obName').value || '').trim();
            State.profile.role = ($('#obRole').value || '').trim();
            await dbPut('meta', { id: 'profile', value: State.profile });
          }
          if (steps[step.i] === 'group') {
            const n = ($('#obGroup').value || '').trim();
            if (n && !State.groups.length) await saveGroup({ id: uid('grp'), name: n, description: '', leader: State.profile.name || '', color: $('#obColor').value || State.settings.accent, inviteCode: n.slice(0, 3).toUpperCase() + new Date().getFullYear(), status: 'active', notes: '', logoFileId: null, songIds: [], createdAt: nowISO(), updatedAt: nowISO() });
            if (State.profile.name && !State.members.length && State.groups.length) await saveMember({ id: uid('mem'), name: State.profile.name, roles: State.profile.role ? [State.profile.role] : [], avatar: State.profile.name[0].toUpperCase(), color: State.groups[0].color, status: 'active', groupIds: [State.groups[0].id], contacts: { phone: '', email: '', telegram: '', whatsapp: '' }, note: '', createdAt: nowISO(), updatedAt: nowISO() });
          }
          step.i++; render();
        });
        if (back) back.addEventListener('click', () => { step.i = Math.max(0, step.i - 1); render(); });
        if (skip) skip.addEventListener('click', () => complete(false));
        $$('[data-ob-theme]').forEach(b => b.addEventListener('click', () => {
          applyTheme(b.getAttribute('data-ob-theme'));
          $$('[data-ob-theme]').forEach(x => x.classList.toggle('btn-primary', x === b));
        }));
        $$('[data-ob-accent]').forEach(b => b.addEventListener('click', () => {
          applyAccent(b.getAttribute('data-ob-accent'));
          $$('[data-ob-accent]').forEach(x => x.classList.toggle('on', x === b));
          buildManifest();
        }));
        const dy = $('#obDemoYes'), dn = $('#obDemoNo');
        if (dy) dy.addEventListener('click', () => complete(true));
        if (dn) dn.addEventListener('click', () => complete(false));
      }
    });
  };
  async function complete(withDemo) {
    State.settings.onboardingDone = true;
    writePrefs({ onboardingDone: true });
    Modal.close();
    if (withDemo) { await seedDemoData(); Toast.success('Демо-данные загружены'); }
    else Toast.success('BandPlan готов к работе');
    handleRoute();
  }
  render();
}

/* ═══ SECTION 17: WIRING & INIT ═══ */
const ACTIONS = {
  'new-event': () => openEventEditor(),
  'new-event-day': el => { const k = el.getAttribute('data-day'); createEventAt(k, 18 * 60); },
  'new-event-group': el => openEventEditor({ groupId: el.getAttribute('data-id') }),
  'new-song': () => openSongEditor(),
  'new-setlist': () => openSetlistEditor(),
  'new-setlist-group': el => openSetlistEditor({ groupId: el.getAttribute('data-id') }),
  'new-group': () => openGroupEditor(),
  'new-member': () => openMemberEditor(),
  'edit-event': el => openEventEditor({ id: el.getAttribute('data-id') }),
  'edit-song': el => openSongEditor({ id: el.getAttribute('data-id') }),
  'edit-setlist': el => openSetlistEditor({ id: el.getAttribute('data-id') }),
  'edit-group': el => openGroupEditor({ id: el.getAttribute('data-id') }),
  'event-details': el => openEventDetails(el.getAttribute('data-id'), el.getAttribute('data-occ')),
  'delete-event': el => confirmDeleteEvent(el.getAttribute('data-id')),
  'duplicate-event': el => duplicateEvent(el.getAttribute('data-id')),
  'my-status': el => setMyStatus(el.getAttribute('data-id'), el.getAttribute('data-val')),
  'recur-edit-one': el => editOneOccurrence(el.getAttribute('data-id'), el.getAttribute('data-occ')),
  'recur-cancel-one': el => cancelOneOccurrence(el.getAttribute('data-id'), el.getAttribute('data-occ')),
  'cal-nav': el => calendarNav(parseInt(el.getAttribute('data-dir'), 10)),
  'cal-view': el => setCalendarView(el.getAttribute('data-val')),
  'cal-today': () => goToToday(),
  'cal-week-of-day': el => { State.ui.calendarDate = new Date(el.getAttribute('data-day') + 'T12:00:00'); setCalendarView('week'); },
  'delete-song': el => confirmDeleteSong(el.getAttribute('data-id')),
  'duplicate-song': el => duplicateSong(el.getAttribute('data-id')),
  'fav-song': el => toggleFavorite(el.getAttribute('data-id')),
  'song-to-setlist': el => songToSetlist(el.getAttribute('data-id')),
  'export-song': el => {
    const s = findSong(el.getAttribute('data-id')); if (!s) return;
    if (downloadFile(safeFile(s.title) + '.txt', songToText(s, State.ui.transpose || 0), 'text/plain;charset=utf-8')) Toast.success('Песня экспортирована в TXT');
  },
  'print-preview-song': el => { const s = findSong(el.getAttribute('data-id')); if (s) printSongs([s], State.ui.transpose || 0); },
  'save-version': async el => {
    const s = findSong(el.getAttribute('data-id')); if (!s) return;
    await snapshotVersion(s);
    await logActivity('song', 'Зафиксирована версия «' + s.title + '»', s.id);
    Toast.success('Версия сохранена');
    renderSongDetail(s.id);
  },
  'restore-version': el => restoreVersion(el.getAttribute('data-id')),
  'delete-version': el => deleteVersion(el.getAttribute('data-id')),
  'transpose': el => adjustTranspose(parseInt(el.getAttribute('data-d'), 10)),
  'transpose-reset': () => resetTranspose(),
  'song-filter': el => {
    State.ui.songs.filter = el.getAttribute('data-val');
    $$('#songFilterTabs .tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    el.classList.add('active'); el.setAttribute('aria-selected', 'true');
    renderSongList();
  },
  'reset-song-filters': () => {
    State.ui.songs = { filter: 'all', sort: 'updated', query: '', group: '', genre: '', key: '', language: '', tag: '', favOnly: false };
    renderSongs();
  },
  'toggle-select-mode': () => {
    State.ui.selectMode = !State.ui.selectMode;
    if (!State.ui.selectMode) State.ui.selection.clear();
    renderSongList(); renderSelectionBar();
  },
  'select-all': () => {
    const list = filteredSongs();
    if (State.ui.selection.size === list.length) State.ui.selection.clear();
    else list.forEach(s => State.ui.selection.add(s.id));
    renderSongList(); renderSelectionBar();
  },
  'bulk-print': () => {
    const songs = Array.from(State.ui.selection).map(findSong).filter(Boolean);
    if (!songs.length) return Toast.warning('Выберите песни');
    printSongs(songs, 0);
  },
  'bulk-export': () => bulkExportSelection(),
  'bulk-setlist': () => bulkAddToSetlist(),
  'bulk-group': () => bulkAssignGroup(),
  'bulk-fav': () => bulkFavorite(),
  'bulk-delete': () => bulkDelete(),
  'band-tab': el => {
    State.ui.bandTab = el.getAttribute('data-val');
    State.ui.bandQuery = '';
    $$('#bandTabs .tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderBandContent();
  },
  'add-song-to-setlist': el => addSongToSetlist(el.getAttribute('data-id')),
  'sl-remove': el => removeSetlistItem(el.getAttribute('data-sl'), el.getAttribute('data-item')),
  'sl-edit-item': el => editSetlistItem(el.getAttribute('data-sl'), el.getAttribute('data-item')),
  'sl-up': el => moveSetlistItem(el.getAttribute('data-sl'), el.getAttribute('data-item'), -1),
  'sl-down': el => moveSetlistItem(el.getAttribute('data-sl'), el.getAttribute('data-item'), 1),
  'sl-song': el => navigate('#/songs/' + el.getAttribute('data-id')),
  'sl-status': el => setSetlistStatus(el.getAttribute('data-id'), el.getAttribute('data-val')),
  'print-setlist-full': el => printSetlistDialog(el.getAttribute('data-id'), 'full'),
  'print-setlist-short': el => printSetlistDialog(el.getAttribute('data-id'), 'short'),
  'export-setlist': el => {
    const sl = findSetlist(el.getAttribute('data-id')); if (!sl) return;
    Modal.sheet('Экспорт «' + sl.name + '»', [
      { icon: '📄', label: 'Полный текст с аккордами (TXT)', run: () => { downloadFile(safeFile(sl.name) + '.txt', setlistText(sl, 'full'), 'text/plain;charset=utf-8'); Toast.success('TXT сохранён'); } },
      { icon: '📋', label: 'Краткий список (TXT)', sub: 'Названия, тональности, заметки', run: () => { downloadFile(safeFile(sl.name) + '-short.txt', setlistText(sl, 'short'), 'text/plain;charset=utf-8'); Toast.success('TXT сохранён'); } },
      { icon: '📊', label: 'Таблица (CSV)', run: () => { downloadFile(safeFile(sl.name) + '.csv', setlistCSV(sl), 'text/csv;charset=utf-8'); Toast.success('CSV сохранён'); } },
      { icon: '🖨️', label: 'Печать / PDF', run: () => printSetlistDialog(sl.id, 'full') }
    ]);
  },
  'duplicate-setlist': el => duplicateSetlist(el.getAttribute('data-id')),
  'delete-setlist': el => confirmDeleteSetlist(el.getAttribute('data-id')),
  'setlist-for-event': el => createSetlistForEvent(el.getAttribute('data-id')),
  'launch-scene': el => launchScene(el.getAttribute('data-id')),
  'scene-from-song': el => launchSceneFromSong(el.getAttribute('data-id'), false),
  'scene-from-song-auto': el => launchSceneFromSong(el.getAttribute('data-id'), true),
  'scene-from-event': el => launchSceneFromEvent(el.getAttribute('data-id')),
  'scene-font': el => sceneFont(parseInt(el.getAttribute('data-d'), 10)),
  'archive-group': el => toggleGroupArchive(el.getAttribute('data-id')),
  'unarchive-group': el => toggleGroupArchive(el.getAttribute('data-id')),
  'delete-group': el => confirmDeleteGroup(el.getAttribute('data-id')),
  'delete-member': el => confirmDeleteMember(el.getAttribute('data-id')),
  'group-assign-songs': el => groupAssignSongs(el.getAttribute('data-id')),
  'group-unassign-song': el => groupUnassignSong(el.getAttribute('data-id'), el.getAttribute('data-val')),
  'group-remove-logo': async el => {
    const g = findGroup(el.getAttribute('data-id')); if (!g) return;
    if (g.logoFileId) await deleteFile(g.logoFileId);
    g.logoFileId = null; await saveGroup(g);
    Modal.close(); Toast.success('Логотип удалён'); handleRoute();
  },
  'manage-roles': () => manageRoles(),
  'attach-file': el => attachFile(el.getAttribute('data-kind'), el.getAttribute('data-owner')),
  'attach-logo': el => attachFile('logo', el.getAttribute('data-id')),
  'open-file': el => openFile(el.getAttribute('data-id')),
  'delete-file': el => removeFile(el.getAttribute('data-id')),
  'set-theme': el => { applyTheme(el.getAttribute('data-val')); if (State.ui.base === '/more') renderMore(); },
  'set-accent': el => { applyAccent(el.getAttribute('data-val')); $$('#accentRow .accent-swatch').forEach(x => x.classList.toggle('on', x === el)); buildManifest(); },
  'export': () => exportChooser(),
  'export-songs': () => exportChooser(),
  'import': () => triggerImport(),
  'backup-now': () => exportAll(),
  'reset-demo': () => resetDemoData(),
  'clear-all': () => clearAllData(),
  'enable-notifications': () => requestNotifications(),
  'test-notification': () => {
    if (!State.settings.notifications) { Toast.warning('Сначала включите напоминания'); return; }
    notifyUser('Проверка уведомлений', 'Напоминания BandPlan работают. Следующее событие: ' + (upcomingOccurrences(1)[0] ? upcomingOccurrences(1)[0].ev.title : 'не запланировано'), () => navigate('#/calendar'));
  },
  'persist-storage': () => persistStorage(),
  'install-app': () => installApp(),
  'install-dismiss': () => { persistSetting('installDismissed', true); hideInstallBanner(); Toast.info('Баннер скрыт. Установка доступна в разделе «Ещё».'); },
  'logout': () => logoutProfile(),
  'show-help': () => showHelp(),
  'show-privacy': () => showPrivacy(),
  'show-shortcuts': () => showShortcuts()
};
function setlistText(sl, mode) {
  const st = setlistStats(sl), g = findGroup(sl.groupId);
  const ev = State.events.find(e => e.setlistId === sl.id);
  const lines = [sl.name, '='.repeat(Math.max(10, sl.name.length))];
  if (g) lines.push('Группа: ' + g.name);
  if (ev) lines.push('Событие: ' + ev.title + ' · ' + formatDate(ev.start) + ' ' + formatTime(ev.start));
  lines.push('Статус: ' + SETLIST_STATUS[sl.status || 'active']);
  lines.push('Песен: ' + st.count + ' · Ориентировочное время: ' + durationLabel(st.duration) + (st.avgBpm ? ' · Средний BPM: ' + st.avgBpm : ''));
  if (sl.notes) lines.push('Общие заметки: ' + sl.notes);
  lines.push('');
  (sl.items || []).forEach((it, i) => {
    const s = findSong(it.songId);
    if (!s) { lines.push((i + 1) + '. (песня удалена из каталога)'); return; }
    const lead = it.leadMemberId ? findMember(it.leadMemberId) : null;
    const semis = it.keyOverride ? semitoneDiff(s.key, it.keyOverride) : 0;
    lines.push((i + 1) + '. ' + s.title + ' [' + [it.keyOverride || s.key || '—', (it.bpmOverride || s.bpm || '—') + ' BPM', s.timeSignature || '', s.duration ? durationLabel(s.duration) : ''].filter(Boolean).join(' · ') + ']');
    if (lead) lines.push('   Ответственный: ' + lead.name);
    if (it.transition) lines.push('   Переход: ' + it.transition);
    if (it.notes) lines.push('   Заметка: ' + it.notes);
    if (mode === 'full') {
      lines.push('');
      lines.push(transposeLyricsText(s.lyrics, semis));
      lines.push('\n' + '—'.repeat(44) + '\n');
    }
  });
  return lines.join('\n');
}
function setlistCSV(sl) {
  const rows = [['№', 'Песня', 'Исполнитель', 'Тональность', 'BPM', 'Размер', 'Длительность (с)', 'Ответственный', 'Переход', 'Заметка']];
  (sl.items || []).forEach((it, i) => {
    const s = findSong(it.songId) || {}, lead = it.leadMemberId ? findMember(it.leadMemberId) : null;
    rows.push([i + 1, s.title || '—', s.artist || s.author || '', it.keyOverride || s.key || '', it.bpmOverride || s.bpm || '', s.timeSignature || '', s.duration || '', lead ? lead.name : '', it.transition || '', it.notes || '']);
  });
  return toCSV(rows);
}
function wireGlobalClicks() {
  document.addEventListener('click', ev => {
    const t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-modal-close]') && !t.closest('[data-modal-keep]')) Modal.close();
    const go = t.closest('[data-go]');
    if (go) { ev.preventDefault(); navigate(go.getAttribute('data-go')); return; }
    const actEl = t.closest('[data-act]');
    if (actEl) {
      const act = actEl.getAttribute('data-act');
      const fn = ACTIONS[act];
      if (typeof fn === 'function') {
        ev.preventDefault();
        try { const r = fn(actEl); if (r && r.catch) r.catch(e => { Logger.error('action ' + act, e); Toast.error('Действие не выполнено'); }); }
        catch (e) { Logger.error('action ' + act, e); Toast.error('Действие не выполнено'); }
      }
      return;
    }
    if (State.ui.selectMode) {
      const card = t.closest('[data-song]');
      if (card) {
        ev.preventDefault();
        const id = card.getAttribute('data-song');
        if (State.ui.selection.has(id)) State.ui.selection.delete(id); else State.ui.selection.add(id);
        card.classList.toggle('selected', State.ui.selection.has(id));
        const chk = $('.select-check', card); if (chk) chk.textContent = State.ui.selection.has(id) ? '✓' : '';
        renderSelectionBar();
        return;
      }
    }
    const dayEl = t.closest('[data-day]');
    if (dayEl && State.ui.base === '/calendar' && State.ui.calendarView === 'month' && !t.closest('[data-drag-event]')) { onDayCellClick(dayEl.getAttribute('data-day')); return; }
    const songEl = t.closest('[data-song]');
    if (songEl) { navigate('#/songs/' + songEl.getAttribute('data-song')); return; }
    const slEl = t.closest('[data-sl]');
    if (slEl) { navigate('#/band/setlist/' + slEl.getAttribute('data-sl')); return; }
    const evEl = t.closest('[data-event]');
    if (evEl) { openEventDetails(evEl.getAttribute('data-event'), evEl.getAttribute('data-occ')); return; }
    const grEl = t.closest('[data-group]');
    if (grEl) { navigate('#/band/group/' + grEl.getAttribute('data-group')); return; }
    const memEl = t.closest('[data-member]');
    if (memEl) { openMemberEditor({ id: memEl.getAttribute('data-member') }); return; }
    if (!t.closest('#globalSearchWrap') && !t.closest('#searchDropdown')) closeSearchDropdown();
  });
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    const el = ev.target;
    if (!el || !el.closest) return;
    const go = el.closest('[data-go]');
    if (go) { ev.preventDefault(); navigate(go.getAttribute('data-go')); return; }
    const card = el.closest('[data-song],[data-sl],[data-event],[data-group],[data-member],[data-day]');
    if (card) { ev.preventDefault(); card.click(); }
  });
}
function onDayCellClick(k) {
  const d = new Date(k + 'T12:00:00');
  State.ui.selectedDate = d;
  const list = occurrencesOnDate(d);
  $$('.calendar-day').forEach(c => c.classList.toggle('selected', c.getAttribute('data-day') === k));
  if (list.length === 1) openEventDetails(list[0].ev.id, k);
  else if (!list.length) createEventAt(k, 18 * 60);
  else { State.ui.calendarDate = d; setCalendarView('day'); }
}
function handleKeydown(e) {
  const sceneOpen = $('#sceneOverlay').classList.contains('active');
  const paletteOpen = $('#cmdPaletteOverlay').classList.contains('active');
  const modalOpen = Modal.isOpen();
  const ae = document.activeElement;
  const tag = ae ? ae.tagName : '';
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(tag) >= 0 || (ae && ae.isContentEditable);
  if (sceneOpen) {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); scenePrev(); return;
      case 'ArrowRight': e.preventDefault(); sceneNext(); return;
      case ' ': if (!typing) { e.preventDefault(); toggleSceneAuto(); } return;
      case '+': case '=': e.preventDefault(); sceneFont(2); return;
      case '-': case '_': e.preventDefault(); sceneFont(-2); return;
      case '#': e.preventDefault(); sceneTranspose(1); return;
      case 'b': if (e.altKey) { e.preventDefault(); sceneTranspose(-1); } return;
      case 'f': case 'F': if (!typing) { e.preventDefault(); sceneFullscreen(); } return;
      case 'Escape': e.preventDefault(); exitScene(); return;
      default: return;
    }
  }
  if ((e.ctrlKey || e.metaKey) && ['k', 'K', 'л', 'Л'].indexOf(e.key) >= 0) {
    e.preventDefault();
    if (paletteOpen) closeCmdPalette(); else { if (modalOpen) Modal.close(); openCmdPalette(); }
    return;
  }
  if (e.key === 'Escape') {
    if (paletteOpen) { closeCmdPalette(); return; }
    if (modalOpen) { Modal.close(); return; }
    if ($('#searchDropdown').classList.contains('active')) { closeSearchDropdown(); return; }
    if (State.ui.selectMode) { State.ui.selectMode = false; State.ui.selection.clear(); renderSongList(); renderSelectionBar(); return; }
  }
  if (paletteOpen) {
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdIdx = Math.min(cmdResults.length - 1, cmdIdx + 1); highlightCmd(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdIdx = Math.max(0, cmdIdx - 1); highlightCmd(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdIdx); }
    return;
  }
  if (typing || modalOpen) return;
  if (State.ui.base === '/calendar' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].indexOf(e.key) >= 0) {
    const d = new Date(State.ui.calendarDate), v = State.ui.calendarView;
    if (e.key !== 'Enter') {
      e.preventDefault();
      if (e.key === 'ArrowLeft') d.setDate(d.getDate() - 1);
      if (e.key === 'ArrowRight') d.setDate(d.getDate() + 1);
      if (e.key === 'ArrowUp') d.setDate(d.getDate() - (v === 'month' ? 7 : 1));
      if (e.key === 'ArrowDown') d.setDate(d.getDate() + (v === 'month' ? 7 : 1));
      State.ui.calendarDate = d; State.ui.selectedDate = d;
      if (v === 'month' || v === 'agenda') renderCalendar(); else renderCalendarContent();
      return;
    }
    e.preventDefault();
    const list = occurrencesOnDate(d);
    if (list.length) openEventDetails(list[0].ev.id, dateKey(d)); else createEventAt(dateKey(d), 18 * 60);
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'n' || k === 'т') { e.preventDefault(); openSongEditor(); }
  else if (k === 'e' || k === 'у') { e.preventDefault(); openEventEditor(); }
  else if (k === 's' || k === 'ы') { e.preventDefault(); openSetlistEditor(); }
  else if (k === 't' || k === 'е') { e.preventDefault(); toggleTheme(); }
  else if (k === '?' || (k === '/' && e.shiftKey)) { e.preventDefault(); showShortcuts(); }
  else if (k === 'g' || k === 'п') { State.ui._gPrefix = true; setTimeout(() => { State.ui._gPrefix = false; }, 1200); }
  else if (State.ui._gPrefix) {
    State.ui._gPrefix = false;
    if (k === 'c' || k === 'с') navigate('#/calendar');
    else if (k === 's' || k === 'ы') navigate('#/songs');
    else if (k === 'b' || k === 'и') navigate('#/band');
    else if (k === 'm' || k === 'ь') navigate('#/more');
  }
}
const refreshCountdowns = throttleRAF(function () {
  $$('[data-countdown]').forEach(el => {
    const p = (el.getAttribute('data-countdown') || '').split('|');
    if (p[1]) el.textContent = countdownText(p[1]);
  });
});
function wireStaticEvents() {
  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('online', () => { Toast.success('Соединение восстановлено. Данные сохранены локально.'); if (State.ui.base === '/more') renderMore(); });
  window.addEventListener('offline', () => { Toast.info('Нет сети — BandPlan продолжает работать офлайн'); if (State.ui.base === '/more') renderMore(); });
  const bind = (sel, ev, fn, o) => { const x = $(sel); if (x) x.addEventListener(ev, fn, o); };
  bind('#themeQuickToggle', 'click', toggleTheme);
  bind('#themeQuickToggleTop', 'click', toggleTheme);
  bind('#cmdPaletteBtn', 'click', openCmdPalette);
  bind('#installBtn', 'click', installApp);
  bind('#installSideBtn', 'click', installApp);
  bind('#cmdPaletteOverlay', 'click', ev => { if (ev.target.id === 'cmdPaletteOverlay') closeCmdPalette(); });
  bind('#modalOverlay', 'click', ev => { if (ev.target.id === 'modalOverlay') Modal.close(); });
  bind('#cmdInput', 'input', debounce(ev => renderCmdResults(ev.target.value), 120), { passive: true });
  bind('#fileInput', 'change', () => handleFilesPicked($('#fileInput')), { passive: true });
  const gs = $('#globalSearch');
  gs.addEventListener('input', debounce(ev => handleGlobalSearch(ev.target.value), 170), { passive: true });
  gs.addEventListener('focus', ev => { if (ev.target.value.trim().length >= 2) handleGlobalSearch(ev.target.value); });
  gs.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { closeSearchDropdown(); gs.blur(); }
    if (ev.key === 'Enter') {
      const first = $('#searchDropdown .search-result-item');
      if (first) { ev.preventDefault(); first.click(); }
      else if (gs.value.trim()) { ev.preventDefault(); closeSearchDropdown(); State.ui.songs.query = gs.value.trim(); gs.value = ''; navigate('#/songs'); }
    }
  });
  bind('#scenePrev', 'click', scenePrev);
  bind('#sceneNext', 'click', sceneNext);
  bind('#sceneScroll', 'click', toggleSceneAuto);
  bind('#sceneSpeed', 'click', cycleSceneSpeed);
  bind('#sceneFontInc', 'click', () => sceneFont(2));
  bind('#sceneFontDec', 'click', () => sceneFont(-2));
  bind('#sceneTransInc', 'click', () => sceneTranspose(1));
  bind('#sceneTransDec', 'click', () => sceneTranspose(-1));
  bind('#sceneFullscreen', 'click', sceneFullscreen);
  bind('#sceneExit', 'click', exitScene);
  bind('#sceneLyrics', 'scroll', updateSceneProgress, { passive: true });
  bind('#sceneLyrics', 'wheel', () => { if (State.ui.scene.auto) toggleSceneAuto(); }, { passive: true });
  bind('#sceneLyrics', 'touchstart', () => { if (State.ui.scene.auto) toggleSceneAuto(); }, { passive: true });
  document.addEventListener('keydown', handleKeydown);
  setupSceneTouch();
  State.subscribe(updateNavCounts);
  if (systemMQ && systemMQ.addEventListener) systemMQ.addEventListener('change', () => { if (State.settings.systemTheme) { applyTheme('system', true); } });
  setInterval(() => {
    refreshCountdowns();
    if (State.ui.base === '/calendar' && State.ui.calendarView === 'week' && !State.ui.dragging && !Modal.isOpen()) {
      const line = $('#tgridNow');
      if (line) { const n = new Date(); line.style.top = clamp(n.getHours() * 60 + n.getMinutes() - GRID_START * 60, 0, (GRID_END - GRID_START) * 60) * PX_PER_MIN + 'px'; }
    }
  }, 30000);
  window.addEventListener('beforeunload', () => { stopSceneScroll(); releaseWakeLock(); });
  window.addEventListener('error', ev => Logger.error('runtime', ev.message));
  window.addEventListener('unhandledrejection', ev => Logger.error('promise', ev.reason));
}
async function init() {
  try { await loadState(); }
  catch (err) { Logger.error('loadState', err); rebuildIndex(); Toast.error('Локальная база недоступна — данные сохранятся только в этой сессии'); }
  buildManifest();
  wireStaticEvents();
  wireGlobalClicks();
  State.ready = true;
  handleRoute();
  startReminderScheduler();
  setupInstallPrompt();
  const empty = !State.songs.length && !State.events.length && !State.groups.length && !State.members.length;
  if (empty && !State.settings.onboardingDone) startOnboarding();
  else { State.settings.onboardingDone = true; writePrefs({ onboardingDone: true }); Toast.success('BandPlan готов к работе'); }
  if (storageMode !== 'indexeddb') Toast.warning('IndexedDB недоступен: изменения сохранятся только до закрытия вкладки. Создайте резервную копию.');
}
window.BP = {
  State, navigate, handleRoute, openSongEditor, openEventEditor, openSetlistEditor, openGroupEditor, openMemberEditor,
  openEventDetails, launchScene, launchSceneFromEvent, launchSceneFromSong, exitScene, manageRoles,
  exportAll, exportChooser, resetDemoData, clearAllData, applyTheme, applyAccent, toggleTheme, openCmdPalette,
  showHelp, showPrivacy, showShortcuts, installApp, Toast, Modal, transposeChord, extractChords, version: '3.0'
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();