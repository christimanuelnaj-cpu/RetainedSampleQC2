// verify_missing.mjs
//
// Pins down EXACTLY which records are missing from (or soft-deleted in)
// Firestore, out of the full expected set: the original 165,747-row
// archive PLUS the 126-row delta import.
//
// Doesn't touch or modify any data — read-only, safe to run anytime.
//
// Uses select('deleted') to fetch only the `deleted` field per document
// (not the whole record), which keeps this fast and cheap even scanning
// all ~165,873 documents.
//
// ── HOW TO RUN ──────────────────────────────────────────────────────────
//   cd RetainedSampleQC2
//   git pull
//   node verify_missing.mjs
// ───────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, 'serviceAccountKey.json');

let app;
if (existsSync(keyPath)) {
  const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
  app = initializeApp({ credential: cert(serviceAccount) });
} else {
  app = initializeApp({ credential: applicationDefault() });
}
const db = getFirestore(app);

// --- Same normalization/ID logic as import_to_firestore.mjs / import_delta_records.mjs ---
function normBatch(v) {
  return (v || '').trim().replace(/\s+/g, ' ').toUpperCase();
}
function stableId(date, box, batch, code) {
  const key = `${date}|${box}|${batch}|${code}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return 'imp_' + hash.toString(36);
}

async function main() {
  // ---- Build the full set of expected IDs: original archive + delta ----
  const archivePath = join(__dirname, 'data', 'qc2-archive.json');
  const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
  const ci = Object.fromEntries(archive.cols.map((c, i) => [c, i]));

  const expected = new Map(); // id -> {date, box, batch, code, source}
  for (const r of archive.rows) {
    const date = r[ci.date], box = (r[ci.box] || '').trim();
    const batch = normBatch(r[ci.batch]), code = (r[ci.code] || '').trim();
    const id = stableId(date, box, batch, code);
    expected.set(id, { date, box, batch, code, source: 'original archive' });
  }
  console.log(`Original archive: ${expected.size} expected IDs`);

  const deltaPath = join(__dirname, 'new_records.json');
  if (existsSync(deltaPath)) {
    const delta = JSON.parse(readFileSync(deltaPath, 'utf8'));
    for (const r of delta) {
      const batch = normBatch(r.batch);
      const id = stableId(r.date, r.box, batch, r.code);
      expected.set(id, { date: r.date, box: r.box, batch, code: r.code, source: 'delta import' });
    }
  }
  console.log(`Total expected (archive + delta): ${expected.size} unique IDs\n`);

  // ---- Scan Firestore, collecting every doc ID and its `deleted` flag ----
  // select('deleted') keeps each page cheap — we're not pulling full records.
  const found = new Map(); // id -> deleted (bool)
  const PAGE = 5000;
  let cursor = null;
  let scanned = 0;

  while (true) {
    let q = db.collection('records').orderBy(FieldPath.documentId()).select('deleted').limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      found.set(doc.id, !!doc.data().deleted);
    }
    scanned += snap.size;
    cursor = snap.docs[snap.docs.length - 1];
    console.log(`Scanned ${scanned}...`);
    if (snap.size < PAGE) break;
  }
  console.log(`\nFinished scanning Firestore: ${found.size} documents total.\n`);

  // ---- Diff ----
  const missingEntirely = [];
  const softDeleted = [];
  for (const [id, info] of expected) {
    if (!found.has(id)) {
      missingEntirely.push({ id, ...info });
    } else if (found.get(id) === true) {
      softDeleted.push({ id, ...info });
    }
  }

  console.log('='.repeat(60));
  console.log(`Expected but NOT FOUND in Firestore at all: ${missingEntirely.length}`);
  console.log(`Expected but present as SOFT-DELETED (deleted:true): ${softDeleted.length}`);
  console.log('='.repeat(60));

  if (missingEntirely.length) {
    console.log('\n--- Missing entirely ---');
    for (const r of missingEntirely) {
      console.log(`  [${r.source}] date=${r.date} box=${r.box} batch=${r.batch} code=${r.code}`);
    }
  }
  if (softDeleted.length) {
    console.log('\n--- Soft-deleted (exist, but deleted:true — likely intentional cleanup via the app) ---');
    for (const r of softDeleted) {
      console.log(`  [${r.source}] date=${r.date} box=${r.box} batch=${r.batch} code=${r.code}`);
    }
  }
  if (!missingEntirely.length && !softDeleted.length) {
    console.log('\nEverything expected is present and active. The count difference, if any,');
    console.log('must come from something outside this comparison (e.g. records edited to a');
    console.log('different key by hand) — re-run rebuild_stats.mjs and compare again.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
