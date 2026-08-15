// QC2 data layer: IndexedDB persistence, grouping rules, backup/export/import/merge.
const DB_NAME = 'qc2', DB_VERSION = 1;

export const GROUPS = ['FG', 'SF', 'Filling'];

// Product group rule:
//  - batch number carrying a standalone trailing "F"  -> Filling
//  - box number prefixed "SF"                          -> SF (semi finish)
//  - otherwise                                         -> FG (finish goods)
export function deriveGroup(batch, box) {
  const b = (batch || '').trim().toUpperCase();
  if (/(^|[\s-])F$/.test(b) || /\sF\b/.test(b)) return 'Filling';
  if (/^SF/i.test((box || '').trim())) return 'SF';
  return 'FG';
}

export function normBatch(v) {
  return (v || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function isPlaceholderBatch(v) {
  const b = normBatch(v);
  return !b || /^[-–—]+$/.test(b) || b === 'NOBATCH' || b === 'NO BATCH';
}

export function uid() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function makeRecord(input) {
  const batch = normBatch(input.batch);
  return {
    id: input.id || uid(),
    date: input.date || '',
    box: (input.box || '').trim(),
    batch,
    code: (input.code || '').trim(),
    note: (input.note || '').trim(),
    group: input.group || deriveGroup(batch, input.box),
    status: input.status || 'ok',
    loans: Array.isArray(input.loans) ? input.loans : [],
    statusNote: (input.statusNote || '').trim(),
    statusAt: input.statusAt || '',
    updatedAt: input.updatedAt || new Date().toISOString(),
    deleted: !!input.deleted,
  };
}

function open() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('batch', 'batch', { unique: false });
      }
      if (!db.objectStoreNames.contains('audit')) {
        db.createObjectStore('audit', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'k' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

let dbp = null;
function db() { return (dbp = dbp || open()); }

function tx(store, mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store), t);
    t.oncomplete = () => res(out && out.__val !== undefined ? out.__val : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

/* ---------- Firebase Cloud Integration (Firestore + Realtime Database) ---------- */

const FIREBASE_CONFIG = window.FIREBASE_WEBAPP_CONFIG
  ? { ...window.FIREBASE_WEBAPP_CONFIG, databaseURL: 'https://retainedsampleqc2-default-rtdb.asia-southeast1.firebasedatabase.app' }
  : {
    apiKey: "AIzaSyDvpnr8tKOocbfaQ95LVeIZfXmT8C4gPEM",
    authDomain: "retainedsampleqc2.firebaseapp.com",
    projectId: "retainedsampleqc2",
    storageBucket: "retainedsampleqc2.firebasestorage.app",
    messagingSenderId: "827092240429",
    appId: "1:827092240429:web:77a82d12bc01aad53390a4",
    databaseURL: "https://retainedsampleqc2-default-rtdb.asia-southeast1.firebasedatabase.app"
  };

let _app = null;
let fsDb = null;
let rtDb = null;

function getApp() {
  if (_app) return _app;
  if (!window.firebase) return null;
  try {
    _app = window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(FIREBASE_CONFIG);
  } catch (err) {
    console.warn('Firebase init warning:', err);
  }
  return _app;
}

function getFirestore() {
  if (fsDb) return fsDb;
  const app = getApp();
  if (!app) return null;
  try { fsDb = window.firebase.firestore(app); } catch (e) {}
  return fsDb;
}

function getRTDB() {
  if (rtDb) return rtDb;
  const app = getApp();
  if (!app || !window.firebase.database) return null;
  try { rtDb = window.firebase.database(app); } catch (e) {}
  return rtDb;
}

// Track this client's online presence in Realtime Database
export function initPresence() {
  const db = getRTDB();
  if (!db) return;
  try {
    const connRef = db.ref('.info/connected');
    const presenceRef = db.ref('presence/' + uid());
    connRef.on('value', snap => {
      if (!snap.val()) return;
      presenceRef.onDisconnect().remove();
      presenceRef.set({ online: true, at: new Date().toISOString() });
    });
  } catch (e) {
    console.warn('Presence init failed:', e);
  }
}

// Real-time subscription is intentionally disabled for the full records
// collection — a live listener across 165k+ documents costs one Firestore
// read per document per change, which would be prohibitively expensive.
// New entries added in this session appear immediately via optimistic
// local state updates in the UI; the queryRecords() server-side query
// function handles all browsing and search across the full archive.
export function subscribeRecords(onChange) {
  return () => {}; // no-op unsubscribe
}

/* Local IndexedDB helpers */
async function loadAllLocal() {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('records', 'readonly');
    const req = t.objectStore('records').getAll();
    req.onsuccess = () => res(req.result.filter(r => !r.deleted));
    req.onerror = () => rej(req.error);
  });
}

async function putManyLocal(records, onProgress) {
  const d = await db();
  const CHUNK = 5000;
  const CHUNK_TIMEOUT_MS = 30000; // 30 seconds per chunk; if IndexedDB stalls,
                                   // we fail gracefully instead of hanging forever.

  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    try {
      await new Promise((res, rej) => {
        const timeoutId = setTimeout(
          () => rej(new Error(`IndexedDB transaction timeout after ${CHUNK_TIMEOUT_MS}ms on chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(records.length / CHUNK)}`)),
          CHUNK_TIMEOUT_MS
        );
        const t = d.transaction('records', 'readwrite');
        const s = t.objectStore('records');
        for (const r of slice) s.put(r);
        t.oncomplete = () => { clearTimeout(timeoutId); res(); };
        t.onerror = () => { clearTimeout(timeoutId); rej(t.error); };
      });
    } catch (err) {
      console.error(`putManyLocal chunk ${Math.floor(i / CHUNK) + 1} failed:`, err);
      throw err; // Re-throw so the caller knows this failed, rather than silently swallowing it
    }
    if (onProgress) onProgress(Math.min(i + CHUNK, records.length), records.length);
  }
}

async function removeRecordLocal(id) {
  return tx('records', 'readwrite', s => s.delete(id));
}

async function clearAllLocal() {
  await tx('records', 'readwrite', s => s.clear());
  await tx('audit', 'readwrite', s => s.clear());
}

async function logAuditLocal(e) {
  await tx('audit', 'readwrite', s => s.put(e));
}

async function loadAuditLocal() {
  const d = await db();
  return new Promise((res, rej) => {
    const req = d.transaction('audit', 'readonly').objectStore('audit').getAll();
    req.onsuccess = () => res(req.result.sort((a, b) => b.at.localeCompare(a.at)));
    req.onerror = () => rej(req.error);
  });
}

async function getMetaLocal(k) {
  const d = await db();
  return new Promise((res, rej) => {
    const req = d.transaction('meta', 'readonly').objectStore('meta').get(k);
    req.onsuccess = () => res(req.result ? req.result.v : null);
    req.onerror = () => rej(req.error);
  });
}

async function setMetaLocal(k, v) {
  return tx('meta', 'readwrite', s => s.put({ k, v }));
}

/* Public data operations (Firestore Cloud + IndexedDB Sync) */

/* ---------------------------------------------------------------------
   Server-side querying.

   The whole point: never load 165k documents into the browser. Push the
   filtering into Firestore so we only ever read the rows that actually
   match what someone searched for.

   Known constraints, stated plainly:
   - Firestore has NO substring search. `q` does PREFIX matching
     ("010-25" finds "010-2515") against batch, code and box. The free-text
     `note` field is not searchable this way — that would need a dedicated
     search service (Algolia / Typesense) to do properly.
   - Prefix search runs as 3 parallel queries (batch/code/box) which are
     merged client-side, so group/date filters are applied in-memory to
     that small result set rather than in the query.
   - Requires the composite indexes in firestore.indexes.json to be
     deployed, otherwise Firestore rejects the query with a
     FAILED_PRECONDITION error containing a link to auto-create them.
--------------------------------------------------------------------- */

const PREFIX_END = '\uf8ff'; // highest practical unicode char, for range-based prefix matching

function sortFieldFor(sort) {
  return {
    'date-desc': ['date', 'desc'],
    'date-asc': ['date', 'asc'],
    'batch-asc': ['batch', 'asc'],
    'code-asc': ['code', 'asc'],
    'box-asc': ['box', 'asc'],
  }[sort] || ['date', 'desc'];
}

// Prefix search across the three code-like fields, merged and de-duped.
async function queryByPrefix(fs, needle, { group, from, to }) {
  const upper = needle.toUpperCase();
  const fields = [
    ['batch', upper],
    ['code', needle],
    ['box', needle],
  ];

  const snaps = await Promise.all(
    fields.map(([field, value]) =>
      fs.collection('records')
        .orderBy(field)
        .startAt(value)
        .endAt(value + PREFIX_END)
        .limit(500)
        .get()
        .catch(err => {
          console.warn(`Prefix query on "${field}" failed:`, err.message || err);
          return { forEach: () => {} };
        })
    )
  );

  const byId = new Map();
  for (const snap of snaps) {
    snap.forEach(doc => {
      const r = doc.data();
      if (!r.deleted) byId.set(r.id, r);
    });
  }

  // Apply the remaining filters in memory — safe here because this set is
  // already bounded to at most ~1500 rows by the limits above.
  let out = [...byId.values()];
  if (group && group !== 'All') out = out.filter(r => r.group === group);
  if (from) out = out.filter(r => r.date && r.date >= from);
  if (to) out = out.filter(r => r.date && r.date <= to);
  return out;
}

/**
 * Query records with filters applied server-side.
 * Returns { rows, nextCursor, exhausted, mode }.
 *  - mode 'prefix'  : text search path, returns all matches at once (no paging)
 *  - mode 'browse'  : filter/browse path, cursor-paginated
 *  - mode 'local'   : Firestore unavailable, caller should fall back
 */
export async function queryRecords({
  q = '', group = 'All', from = '', to = '', sort = 'date-desc',
  pageSize = 100, cursor = null,
} = {}) {
  const fs = getFirestore();
  if (!fs) return { rows: [], nextCursor: null, exhausted: true, mode: 'local' };

  const needle = (q || '').trim();

  if (needle) {
    const rows = await queryByPrefix(fs, needle, { group, from, to });
    const [field, dir] = sortFieldFor(sort);
    rows.sort((a, b) => {
      const av = a[field] || '', bv = b[field] || '';
      return dir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
    });
    return { rows, nextCursor: null, exhausted: true, mode: 'prefix' };
  }

  // Browse path: equality on group, range on date, cursor pagination.
  // When a date range is active, Firestore requires the range field to be
  // the first orderBy, so date wins over the user's chosen sort there.
  let [field, dir] = sortFieldFor(sort);
  if ((from || to) && field !== 'date') { field = 'date'; dir = 'desc'; }

  let ref = fs.collection('records');
  if (group && group !== 'All') ref = ref.where('group', '==', group);
  if (from) ref = ref.where('date', '>=', from);
  if (to) ref = ref.where('date', '<=', to);
  ref = ref.orderBy(field, dir);
  if (cursor != null) ref = ref.startAfter(cursor);

  // Fetch one extra row to detect whether more pages exist.
  const snap = await ref.limit(pageSize + 1).get();

  const all = [];
  snap.forEach(doc => {
    const r = doc.data();
    if (!r.deleted) all.push(r);
  });

  const hasMore = all.length > pageSize;
  const rows = hasMore ? all.slice(0, pageSize) : all;
  const last = rows[rows.length - 1];

  return {
    rows,
    nextCursor: hasMore && last ? (last[field] || '') : null,
    exhausted: !hasMore,
    mode: 'browse',
  };
}

/**
 * Server-side count matching the current filters, via Firestore's count()
 * aggregation — reads a tiny billing unit rather than every document.
 * Not available for prefix/text search (that path already has its rows).
 */
export async function countRecords({ group = 'All', from = '', to = '' } = {}) {
  const fs = getFirestore();
  if (!fs) return null;
  try {
    let ref = fs.collection('records');
    if (group && group !== 'All') ref = ref.where('group', '==', group);
    if (from) ref = ref.where('date', '>=', from);
    if (to) ref = ref.where('date', '<=', to);
    const snap = await ref.count().get();
    return snap.data().count;
  } catch (e) {
    console.warn('countRecords failed:', e.message || e);
    return null;
  }
}

// Targeted server-side check: does this batch number already exist?
// Used by the Input form instead of scanning s.records (which is now
// empty by design — we can't hold 165k records in browser memory).
export async function batchExists(batch, excludeId = null) {
  const fs = getFirestore();
  if (!fs) return false;
  try {
    const norm = (batch || '').trim().toUpperCase();
    if (!norm) return false;
    let ref = fs.collection('records')
      .where('batch', '==', norm)
      .limit(5);
    const snap = await ref.get();
    let found = false;
    snap.forEach(doc => {
      if (doc.id !== excludeId) found = true;
    });
    return found;
  } catch (e) {
    console.warn('batchExists check failed:', e.message || e);
    return false; // fail open — let the user save, server can validate later
  }
}

export async function loadAll() {
  // At 165k+ documents, loading everything into browser memory is not
  // viable — 40MB of JSON in a single tab, sluggish on any device.
  // The server-side queryRecords() function now handles all browsing
  // and search via proper Firestore queries, so loadAll() just returns
  // an empty array to initialise the component without blocking startup.
  // Dashboard stats are driven by countRecords() per group instead.
  return [];
}

// A commit that never settles (dropped connection, backgrounded tab, mobile
// network hiccup) would otherwise hang the whole merge forever with no error
// and no way for the UI to know. This forces every commit to either finish
// or fail within COMMIT_TIMEOUT_MS.
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

// Runs `tasks` (functions returning promises) with at most `limit` in
// flight at once, instead of one strictly-sequential await per chunk.
// For ~415 chunks this turns "415 round trips back-to-back" into
// "415 round trips, 6 at a time" — both faster and far less exposed to
// any single stalled request blocking everything behind it.
async function runWithConcurrency(tasks, limit) {
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

export async function putMany(records, onProgress) {
  // Local copy first, always — this is the safety net. It already
  // succeeded for your 165,746 records even while the cloud sync hung.
  await putManyLocal(records, onProgress);

  const fs = getFirestore();
  if (!fs || !records.length) return { syncedOnline: true, failedCount: 0 };

  const CHUNK = 400;
  const CONCURRENCY = 6;
  const COMMIT_TIMEOUT_MS = 60000; // 60 seconds — gives Firestore room to breathe
                                    // on slower/mobile connections while still catching
                                    // truly dead requests

  const chunks = [];
  for (let i = 0; i < records.length; i += CHUNK) chunks.push(records.slice(i, i + CHUNK));

  let done = 0;
  let failedCount = 0;
  const tasks = chunks.map((slice, idx) => async () => {
    const batch = fs.batch();
    for (const r of slice) batch.set(fs.collection('records').doc(r.id), r, { merge: true });
    try {
      await withTimeout(batch.commit(), COMMIT_TIMEOUT_MS, `records chunk ${idx + 1}/${chunks.length}`);
    } catch (e) {
      console.error(`Firestore putMany: chunk ${idx + 1}/${chunks.length} failed/timed out — will not block the rest`, e);
      failedCount += slice.length;
      return;
    }
    done += slice.length;
    if (onProgress) onProgress(Math.min(done, records.length), records.length);
  });

  await runWithConcurrency(tasks, CONCURRENCY);

  return { syncedOnline: failedCount === 0, failedCount };
}

export async function removeRecord(id) {
  await removeRecordLocal(id);
  const fs = getFirestore();
  if (fs) {
    try {
      await fs.collection('records').doc(id).delete();
    } catch (e) {
      console.error('Firestore removeRecord error:', e);
    }
  }
}

export async function clearAll() {
  await clearAllLocal();
  const fs = getFirestore();
  if (fs) {
    try {
      const snap = await fs.collection('records').get();
      const batch = fs.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      const auditSnap = await fs.collection('audit').get();
      const auditBatch = fs.batch();
      auditSnap.forEach(doc => auditBatch.delete(doc.ref));
      await auditBatch.commit();
    } catch (e) {
      console.error('Firestore clearAll error:', e);
    }
  }
}

export async function logAudit(entry) {
  const e = { id: uid(), at: new Date().toISOString(), ...entry };
  await logAuditLocal(e);
  const fs = getFirestore();
  if (fs) {
    try {
      await fs.collection('audit').doc(e.id).set(e);
    } catch (err) {
      console.error('Firestore logAudit error:', err);
    }
  }
  return e;
}

export async function loadAudit() {
  const fs = getFirestore();
  if (fs) {
    try {
      const snap = await fs.collection('audit').orderBy('at', 'desc').limit(100).get();
      const audit = [];
      snap.forEach(doc => audit.push(doc.data()));
      if (audit.length > 0) return audit;
    } catch (e) {
      console.warn('Firestore loadAudit failed, fallback to local:', e);
    }
  }
  return loadAuditLocal();
}

export async function getMeta(k) {
  const fs = getFirestore();
  if (fs) {
    try {
      const doc = await fs.collection('meta').doc(k).get();
      if (doc.exists) return doc.data().v;
    } catch (e) {}
  }
  return getMetaLocal(k);
}

export async function setMeta(k, v) {
  await setMetaLocal(k, v);
  const fs = getFirestore();
  if (fs) {
    try {
      await fs.collection('meta').doc(k).set({ k, v });
    } catch (e) {}
  }
}

/* ---------- export / import ---------- */

export function toBackup(records) {
  return JSON.stringify({
    format: 'qc2-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    count: records.length,
    records,
  });
}

const CSV_COLS = ['date', 'box', 'batch', 'code', 'group', 'note', 'status', 'statusAt', 'statusNote', 'updatedAt'];

export function toCSV(records) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [CSV_COLS.join(','), ...records.map(r => CSV_COLS.map(c => esc(r[c])).join(','))].join('\n');
}

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const pick = (r, ...names) => {
    for (const n of names) { const i = head.indexOf(n); if (i >= 0) return r[i]; }
    return '';
  };
  return rows.slice(1).filter(r => r.some(v => v && v.trim())).map(r => makeRecord({
    date: normDate(pick(r, 'date', 'tanggal')),
    box: pick(r, 'box', 'no box', 'nobox'),
    batch: pick(r, 'batch', 'no batch', 'nobatch'),
    code: pick(r, 'code', 'kode produk', 'kode', 'product code'),
    note: pick(r, 'note', 'keterangan'),
    updatedAt: pick(r, 'updatedat') || undefined,
  }));
}

export function normDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d+$/.test(s)) {
    const n = +s;
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

export function parseImport(text, filename) {
  const t = text.trim();
  if (t.startsWith('{')) {
    const j = JSON.parse(t);
    if (Array.isArray(j.records)) return j.records.map(makeRecord);
    if (Array.isArray(j.rows) && Array.isArray(j.cols)) {
      const ix = n => j.cols.indexOf(n);
      const [d, b, ba, c, no] = ['date', 'box', 'batch', 'code', 'note'].map(ix);
      return j.rows.map(r => makeRecord({
        date: normDate(r[d]), box: r[b], batch: r[ba], code: r[c], note: no >= 0 ? r[no] : '',
        updatedAt: '1970-01-01T00:00:00.000Z',
      }));
    }
    throw new Error('Unrecognised JSON backup');
  }
  if (t.startsWith('[')) return JSON.parse(t).map(makeRecord);
  return parseCSV(text);
}

/* ---------- merge ---------- */
// Keyed on batch number (the unique identifier). Newest updatedAt wins.
export function mergeRecords(current, incoming, opts = {}) {
  const strategy = opts.strategy || 'newest';
  const byBatch = new Map();
  const noKey = [];
  for (const r of current) {
    if (isPlaceholderBatch(r.batch)) noKey.push(r);
    else byBatch.set(r.batch, r);
  }
  const report = { added: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: [] };
  for (const raw of incoming) {
    const inc = makeRecord(raw);
    if (isPlaceholderBatch(inc.batch)) {
      const dup = noKey.find(r => r.date === inc.date && r.box === inc.box && r.code === inc.code);
      if (dup) { report.unchanged++; continue; }
      noKey.push(inc); byBatch.set('__nk' + inc.id, inc); report.added++; continue;
    }
    const cur = byBatch.get(inc.batch);
    if (!cur) { byBatch.set(inc.batch, inc); report.added++; continue; }
    const same = ['date', 'box', 'code', 'note'].every(k => (cur[k] || '') === (inc[k] || ''));
    if (same) { report.unchanged++; continue; }
    const incNewer = (inc.updatedAt || '') > (cur.updatedAt || '');
    const take = strategy === 'incoming' || (strategy === 'newest' && incNewer);
    if (take) {
      byBatch.set(inc.batch, { ...inc, id: cur.id });
      report.updated++;
      report.conflicts.push({ batch: inc.batch, kept: 'incoming', before: cur, after: inc });
    } else {
      report.skipped++;
      report.conflicts.push({ batch: inc.batch, kept: 'existing', before: inc, after: cur });
    }
  }
  return { records: [...byBatch.values()], report };
}

/* ---------- xlsx ---------- */
// Reads a .xlsx directly (inline strings or shared strings). Understands the
// legacy QC2 workbook shape (tb_box + tb_produk joined on batch number).
export async function parseXlsx(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .xlsx file');
  let off = dv.getUint32(eocd + 16, true);
  const n = dv.getUint16(eocd + 10, true);
  const files = {};
  for (let i = 0; i < n; i++) {
    const nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
    files[new TextDecoder().decode(buf.slice(off + 46, off + 46 + nl))] =
      { method: dv.getUint16(off + 10, true), size: dv.getUint32(off + 20, true), lho: dv.getUint32(off + 42, true) };
    off += 46 + nl + el + cl;
  }
  const read = async name => {
    const f = files[name]; if (!f) return '';
    const nl = dv.getUint16(f.lho + 26, true), el = dv.getUint16(f.lho + 28, true);
    const start = f.lho + 30 + nl + el;
    const d = buf.slice(start, start + f.size);
    if (f.method === 0) return new TextDecoder().decode(d);
    return new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
  const dec = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const sstXml = await read('xl/sharedStrings.xml');
  const sst = sstXml ? [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))) : [];
  const sheetNames = [...(await read('xl/workbook.xml')).matchAll(/<sheet[^>]*name="([^"]*)"/g)].map(m => m[1]);
  const readSheet = async idx => {
    const xml = await read(`xl/worksheets/sheet${idx}.xml`);
    if (!xml) return [];
    const out = [];
    for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<is>([\s\S]*?)<\/is>|<v>([\s\S]*?)<\/v>)?<\/c>/g)) {
        let col = 0;
        for (const ch of cm[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
        col -= 1;
        let v = '';
        if (cm[3] !== undefined) v = dec([...cm[3].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        else if (cm[4] !== undefined) v = /t="s"/.test(cm[2]) ? (sst[+cm[4]] || '') : dec(cm[4]);
        cells[col] = v;
      }
      out.push(cells);
    }
    return out;
  };
  const sheets = {};
  for (let i = 0; i < sheetNames.length; i++) sheets[sheetNames[i]] = await readSheet(i + 1);
  const headerIx = (rows, ...names) => {
    const h = (rows[0] || []).map(x => (x || '').trim().toLowerCase());
    for (const nm of names) { const i = h.indexOf(nm); if (i >= 0) return i; }
    return -1;
  };
  const boxSheet = sheets['tb_box'] || Object.values(sheets)[0] || [];
  const prodSheet = sheets['tb_produk'] || Object.values(sheets)[1] || [];
  const codeByBatch = new Map();
  if (prodSheet.length) {
    const ci = headerIx(prodSheet, 'kode produk', 'code', 'kode');
    const bi = headerIx(prodSheet, 'no batch', 'batch', 'nobatch');
    if (ci >= 0 && bi >= 0) for (const r of prodSheet.slice(1)) {
      const b = normBatch(r[bi]);
      if (b && !codeByBatch.has(b)) codeByBatch.set(b, (r[ci] || '').trim());
    }
  }
  const di = headerIx(boxSheet, 'tanggal', 'date');
  const bxi = headerIx(boxSheet, 'no box', 'box', 'nobox');
  const bi = headerIx(boxSheet, 'no batch', 'batch', 'nobatch');
  const ki = headerIx(boxSheet, 'keterangan', 'note');
  const ci = headerIx(boxSheet, 'kode produk', 'code');
  if (bi < 0) throw new Error('No batch column found in the workbook');
  const stamp = '1970-01-01T00:00:00.000Z';
  return boxSheet.slice(1)
    .filter(r => r.some(v => v && String(v).trim()))
    .map(r => {
      const batch = normBatch(r[bi]);
      return makeRecord({
        date: di >= 0 ? normDate(r[di]) : '',
        box: bxi >= 0 ? r[bxi] : '',
        batch,
        code: ci >= 0 ? r[ci] : (codeByBatch.get(batch) || ''),
        note: ki >= 0 ? r[ki] : '',
        updatedAt: stamp,
      });
    });
}

export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
