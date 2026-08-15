// Computes the meta/stats document that the app reads for its dashboard
// counts (total entries, per-group breakdown).
//
// Why this exists: counting 165k documents from the browser on every page
// load was slow and silently failing. Instead the app reads a single tiny
// stats document. This script (re)computes it.
//
// Run in Cloud Shell whenever the counts look wrong:
//   node rebuild_stats.mjs

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = initializeApp({ credential: applicationDefault() });
const db = getFirestore(app);

// Same placeholder-batch check as qc2-store.js — kept in sync deliberately.
function normBatch(v) {
  return (v || '').trim().replace(/\s+/g, ' ').toUpperCase();
}
function isPlaceholderBatch(v) {
  const b = normBatch(v);
  return !b || /^[-–—]+$/.test(b) || b === 'NOBATCH' || b === 'NO BATCH';
}

async function main() {
  console.log('Reading all records to compute counts (paginated, this takes a bit)...');

  const groups = { FG: 0, SF: 0, Filling: 0 };
  const statuses = { ok: 0, borrowed: 0 };
  const boxes = new Set();
  const codes = new Set();
  let total = 0;
  let softDeleted = 0;
  let unknownGroup = 0;
  let placeholderBatchCount = 0;
  let scanned = 0;
  let cursor = null;
  const PAGE = 5000; // small enough to comfortably finish well under any deadline

  for (;;) {
    let q = db.collection('records')
      .select('group', 'deleted', 'box', 'code', 'status', 'batch')
      .orderBy('__name__')
      .limit(PAGE);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    snap.forEach(doc => {
      const d = doc.data();
      scanned++;
      if (d.deleted) { softDeleted++; return; }
      total++;
      if (groups[d.group] != null) groups[d.group]++;
      else unknownGroup++;
      const st = d.status || 'ok';
      statuses[st] = (statuses[st] || 0) + 1;
      if (d.box) boxes.add(d.box);
      if (d.code) codes.add(d.code);
      if (isPlaceholderBatch(d.batch)) placeholderBatchCount++;
    });

    cursor = snap.docs[snap.docs.length - 1];
    console.log(`Scanned ${scanned}...`);

    if (snap.size < PAGE) break; // last page
  }

  console.log(`\nFinished scanning ${scanned} documents.`);

  console.log('\n--- Computed ---');
  console.log(`Active records      : ${total}`);
  console.log(`  FG                : ${groups.FG}`);
  console.log(`  SF                : ${groups.SF}`);
  console.log(`  Filling           : ${groups.Filling}`);
  console.log(`Status: available   : ${statuses.ok}`);
  console.log(`Status: on loan     : ${statuses.borrowed}`);
  console.log(`Distinct boxes      : ${boxes.size}`);
  console.log(`Distinct codes      : ${codes.size}`);
  console.log(`Placeholder batches : ${placeholderBatchCount} (data quality flag)`);
  if (unknownGroup) console.log(`  (unrecognised group value: ${unknownGroup})`);
  if (softDeleted) console.log(`Soft-deleted        : ${softDeleted} (excluded from counts)`);

  await db.collection('meta').doc('stats').set({
    total,
    groups,
    statuses,
    boxCount: boxes.size,
    codeCount: codes.size,
    placeholderBatchCount,
    updatedAt: new Date().toISOString(),
  });

  console.log('\nWrote meta/stats. Reload the app — the dashboard should now show these numbers.');
}

main().catch(err => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
