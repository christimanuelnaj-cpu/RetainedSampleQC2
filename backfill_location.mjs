// backfill_location.mjs
//
// WHY THIS EXISTS
// ─────────────────────────────────────────────────────────────────────
// The Location feature (Plant 1 / Plant 2) is fully built in the app —
// schema, filters, buttons, indexes, dashboard stats — but Firestore is
// schemaless, so any document written *before* this feature existed
// simply doesn't have a `location` field at all, not even an implicit
// 'Plant 1'.
//
// That's invisible almost everywhere in the app, because the UI reads
// `r.location || 'Plant 1'` — a record with no field at all still
// *displays* as Plant 1. But it breaks silently in exactly one place:
// Firestore's `.where('location', '==', 'Plant 1')` query does NOT match
// documents where the field is simply absent. So filtering the Records
// page by "Plant 1" would show only the handful of records someone has
// explicitly clicked the Plant 1 button on — not the ~165,873 records
// that are conceptually Plant 1 by default.
//
// This script closes that gap once, safely:
//   - Scans every document in `records`.
//   - If `location` is missing entirely  -> sets it to 'Plant 1'.
//   - If `location` already has ANY value (including 'Plant 1' or
//     'Plant 2') -> leaves it completely untouched.
// It will never flip a record that's already been explicitly moved to
// Plant 2 back to Plant 1 — that would be a real data-loss bug, and this
// script is specifically designed to be impossible to do that.
//
// Safe to re-run — after the first run, every document has an explicit
// value, so subsequent runs will find nothing left to backfill.
//
// ── HOW TO RUN ──────────────────────────────────────────────────────────
//   cd RetainedSampleQC2
//   git pull
//   node backfill_location.mjs
//   node rebuild_stats.mjs        (so dashboard/location counts reflect it)
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

async function main() {
  const PAGE = 2000;
  let cursor = null;
  let scanned = 0;
  let toBackfill = [];
  let backfilled = 0;
  let alreadySet = 0;

  console.log('Scanning records for missing `location` field...\n');

  while (true) {
    // select('location') keeps each page cheap — we only need this one
    // field to decide whether a doc needs backfilling.
    let q = db.collection('records').orderBy(FieldPath.documentId()).select('location').limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const data = doc.data();
      // `'location' in data` is deliberately used over `!data.location`
      // so a document that somehow has location explicitly set to an
      // empty string or null is NOT touched — only true absence counts.
      if (!('location' in data)) {
        toBackfill.push(doc.ref);
      } else {
        alreadySet++;
      }
    }

    scanned += snap.size;
    cursor = snap.docs[snap.docs.length - 1];
    console.log(`Scanned ${scanned}... (${toBackfill.length} need backfill so far)`);
    if (snap.size < PAGE) break;
  }

  console.log(`\nFinished scanning ${scanned} documents.`);
  console.log(`Already have an explicit location: ${alreadySet}`);
  console.log(`Missing location entirely (will backfill to 'Plant 1'): ${toBackfill.length}\n`);

  if (!toBackfill.length) {
    console.log('Nothing to do — every document already has a location field. Safe no-op.');
    return;
  }

  const bulkWriter = db.bulkWriter();
  bulkWriter.onWriteError((error) => {
    if (error.failedAttempts < 5) return true;
    console.error(`Permanently failed after 5 attempts: ${error.documentRef.path}`, error.message);
    return false;
  });

  for (const ref of toBackfill) {
    // merge:true touches ONLY the location field — every other field on
    // the document (status, loans, notes, etc.) is left exactly as-is.
    bulkWriter.set(ref, { location: 'Plant 1' }, { merge: true }).catch(() => {});
    backfilled++;
  }

  console.log(`Writing location='Plant 1' to ${backfilled} documents...`);
  await bulkWriter.close();

  console.log(`\nDone. Backfilled ${backfilled} documents.`);
  console.log("Next step: node rebuild_stats.mjs   (so the dashboard's location breakdown is accurate)");
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
