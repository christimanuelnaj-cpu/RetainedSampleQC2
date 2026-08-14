// One-time bulk import: data/qc2-archive.json -> Firestore `records` collection.
//
// Runs server-side via the Firebase Admin SDK — NOT through the browser.
// This bypasses Firestore security rules and App Check entirely (Admin SDK
// is a trusted context), and uses BulkWriter, which has automatic batching,
// rate-limiting and retry built in. This is the professional way to do a
// one-time bulk import of hundreds of thousands of documents; a browser
// client SDK was never really the right tool for this job.
//
// ── HOW TO RUN THIS (pick ONE option) ──────────────────────────────────
//
// OPTION A — Google Cloud Shell (recommended, works from any device,
//            including a phone browser, no downloads needed):
//   1. Go to https://console.cloud.google.com/ , log into the Google
//      account that owns this Firebase project.
//   2. Click the ">_" Cloud Shell icon (top right) to open a terminal.
//   3. Clone your repo:
//        git clone https://github.com/christimanuelnaj-cpu/RetainedSampleQC2.git
//        cd RetainedSampleQC2
//   4. Set the active project (find PROJECT_ID in Firebase Console -> gear
//      icon -> Project settings -> "Project ID"):
//        gcloud config set project PROJECT_ID
//   5. Install the one extra dependency this script needs:
//        npm install firebase-admin --no-save
//   6. Run it:
//        node import_to_firestore.mjs
//   Cloud Shell is already authenticated as you, so this just works — no
//   service account key file needed at all.
//
// OPTION B — Your own computer with Node.js installed:
//   1. Firebase Console -> gear icon -> Project settings -> Service
//      accounts tab -> "Generate new private key" -> saves a JSON file.
//   2. Save it in this project folder as serviceAccountKey.json
//      (already excluded via .gitignore — never commit this file, it
//      grants full read/write access to your entire project).
//   3. npm install firebase-admin
//   4. node import_to_firestore.mjs
// ─────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import admin from 'firebase-admin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keyPath = join(__dirname, 'serviceAccountKey.json');

if (existsSync(keyPath)) {
  // Option B: explicit service account key file found
  const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log('Using service account key file for authentication.');
} else {
  // Option A: rely on Application Default Credentials (Cloud Shell provides
  // these automatically when you're logged in with project access).
  admin.initializeApp();
  console.log('No serviceAccountKey.json found — using Application Default Credentials (fine for Cloud Shell).');
}

const db = admin.firestore();

// --- Same field logic as qc2-store.js, kept in sync deliberately -------
function normBatch(v) {
  return (v || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function deriveGroup(batch, box) {
  const b = (batch || '').trim().toUpperCase();
  if (/(^|[\s-])F$/.test(b) || /\sF\b/.test(b)) return 'Filling';
  if (/^SF/i.test((box || '').trim())) return 'SF';
  return 'FG';
}

// Deterministic ID derived from stable fields, NOT a random uid(). This
// makes the import naturally idempotent — if this script is interrupted
// and re-run, it will overwrite the same documents rather than creating
// duplicates. (Browser-entered records still use qc2-store.js's random
// uid() and are unaffected by this.)
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
  const archivePath = join(__dirname, 'data', 'qc2-archive.json');
  console.log('Reading', archivePath);
  const raw = JSON.parse(readFileSync(archivePath, 'utf8'));
  const { cols, rows } = raw;
  console.log(`Loaded ${rows.length} rows. Columns: ${cols.join(', ')}`);

  const colIndex = Object.fromEntries(cols.map((c, i) => [c, i]));
  const now = new Date().toISOString();

  const bulkWriter = db.bulkWriter();
  let written = 0;
  let errored = 0;

  bulkWriter.onWriteError((error) => {
    errored++;
    if (error.failedAttempts < 5) {
      return true; // let BulkWriter retry automatically, up to 5 attempts
    }
    console.error(`Permanently failed after 5 attempts: ${error.documentRef.path}`, error.message);
    return false;
  });

  const startTime = Date.now();
  for (const row of rows) {
    const obj = {};
    for (const c of cols) obj[c] = row[colIndex[c]];
    const record = makeRecord(obj, now);

    const ref = db.collection('records').doc(record.id);
    bulkWriter.set(ref, record, { merge: true });

    written++;
    if (written % 5000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Queued ${written} / ${rows.length} (${elapsed}s elapsed)...`);
    }
  }

  console.log('All writes queued, waiting for BulkWriter to flush + finish (this is the slow part)...');
  await bulkWriter.close();

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${totalTime}s. Queued: ${written}, permanent errors: ${errored}.`);
  console.log('Check Firebase Console -> Firestore Database -> records collection to verify.');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
