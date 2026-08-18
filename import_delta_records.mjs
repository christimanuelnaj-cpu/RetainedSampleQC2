// import_delta_records.mjs
//
// Imports ONLY the records found in QC2.mdb that are missing from Firestore
// (see MISSING_DATA_REPORT.md for how this list was produced).
//
// This is deliberately a separate, small script rather than re-running the
// full import_to_firestore.mjs against the whole .mdb — importing only the
// delta avoids re-touching all 165,747 existing documents and keeps this
// operation fast, cheap, and easy to review before running.
//
// Uses the exact same normBatch/deriveGroup/stableId logic as
// import_to_firestore.mjs, kept in sync deliberately. Safe to re-run: the
// deterministic ID makes this idempotent, so running it twice just
// overwrites the same 126 documents rather than duplicating them.
//
// ── HOW TO RUN ──────────────────────────────────────────────────────────
// Same options as import_to_firestore.mjs — Cloud Shell (recommended) or
// local Node with a serviceAccountKey.json. From the project root:
//
//   git clone https://github.com/christimanuelnaj-cpu/RetainedSampleQC2.git
//   cd RetainedSampleQC2
//   gcloud config set project retainedsampleqc2
//   npm install firebase-admin --no-save
//   node import_delta_records.mjs
//
// Then rebuild stats so the dashboard counts reflect the 126 new records:
//   node rebuild_stats.mjs
// ───────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, 'serviceAccountKey.json');

let app;
if (existsSync(keyPath)) {
  const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
  app = initializeApp({ credential: cert(serviceAccount) });
  console.log('Using service account key file for authentication.');
} else {
  app = initializeApp({ credential: applicationDefault() });
  console.log('No serviceAccountKey.json found — using Application Default Credentials (fine for Cloud Shell).');
}

const db = getFirestore(app);

// --- Same field logic as qc2-store.js / import_to_firestore.mjs, kept in sync deliberately ---
function normBatch(v) {
  return (v || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function deriveGroup(batch, box) {
  const b = (batch || '').trim().toUpperCase();
  if (/(^|[\s-])F$/.test(b) || /\sF\b/.test(b)) return 'Filling';
  if (/^SF/i.test((box || '').trim())) return 'SF';
  return 'FG';
}

function stableId(row) {
  const key = `${row.date}|${row.box}|${row.batch}|${row.code}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return 'imp_' + hash.toString(36);
}

function makeRecord(row, now) {
  const batch = normBatch(row.batch);
  return {
    id: stableId(row),
    date: row.date || '',
    box: (row.box || '').trim(),
    batch,
    code: (row.code || '').trim(),
    note: (row.note || '').trim(),
    group: deriveGroup(batch, row.box),
    status: 'ok',
    loans: [],
    statusNote: '',
    statusAt: '',
    updatedAt: now,
    deleted: false,
  };
}

async function main() {
  const dataPath = join(__dirname, 'new_records.json');
  console.log('Reading', dataPath);
  const rows = JSON.parse(readFileSync(dataPath, 'utf8'));
  console.log(`Loaded ${rows.length} delta records to import.`);

  // Safety check: warn (don't block) on anything that looks like a typo,
  // since these were auto-flagged during the diff and are worth a human
  // glance before they land in production data.
  const flagged = rows.filter(r => /--/.test(r.batch));
  if (flagged.length) {
    console.log(`\n⚠️  ${flagged.length} record(s) have a double-dash in the batch number — likely a typo in the source Access data:`);
    for (const r of flagged) console.log(`   ${r.batch}  (box ${r.box}, date ${r.date})`);
    console.log('   Importing as-is; fix in Access + re-run if this needs correcting.\n');
  }

  const now = new Date().toISOString();
  const bulkWriter = db.bulkWriter();
  let written = 0;
  let errored = 0;

  bulkWriter.onWriteError((error) => {
    errored++;
    if (error.failedAttempts < 5) return true;
    console.error(`Permanently failed after 5 attempts: records/${error.documentRef.id}`, error.message);
    return false;
  });

  for (const row of rows) {
    const record = makeRecord(row, now);
    const ref = db.collection('records').doc(record.id);
    bulkWriter.set(ref, record, { merge: true }).catch(() => {});
    written++;
  }

  console.log(`Queued ${written} writes, flushing...`);
  await bulkWriter.close();

  console.log(`\nDone. ${written - errored} succeeded, ${errored} had errors (see above).`);
  console.log('Next step: node rebuild_stats.mjs   (updates dashboard counts to include these)');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
