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

export async function loadAll() {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('records', 'readonly');
    const req = t.objectStore('records').getAll();
    req.onsuccess = () => res(req.result.filter(r => !r.deleted));
    req.onerror = () => rej(req.error);
  });
}

export async function putMany(records, onProgress) {
  const d = await db();
  const CHUNK = 5000;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    await new Promise((res, rej) => {
      const t = d.transaction('records', 'readwrite');
      const s = t.objectStore('records');
      for (const r of slice) s.put(r);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
    if (onProgress) onProgress(Math.min(i + CHUNK, records.length), records.length);
  }
}

export async function removeRecord(id) {
  return tx('records', 'readwrite', s => s.delete(id));
}

export async function clearAll() {
  await tx('records', 'readwrite', s => s.clear());
  await tx('audit', 'readwrite', s => s.clear());
}

export async function logAudit(entry) {
  const e = { id: uid(), at: new Date().toISOString(), ...entry };
  await tx('audit', 'readwrite', s => s.put(e));
  return e;
}

export async function loadAudit() {
  const d = await db();
  return new Promise((res, rej) => {
    const req = d.transaction('audit', 'readonly').objectStore('audit').getAll();
    req.onsuccess = () => res(req.result.sort((a, b) => b.at.localeCompare(a.at)));
    req.onerror = () => rej(req.error);
  });
}

export async function getMeta(k) {
  const d = await db();
  return new Promise((res, rej) => {
    const req = d.transaction('meta', 'readonly').objectStore('meta').get(k);
    req.onsuccess = () => res(req.result ? req.result.v : null);
    req.onerror = () => rej(req.error);
  });
}
export async function setMeta(k, v) {
  return tx('meta', 'readwrite', s => s.put({ k, v }));
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
