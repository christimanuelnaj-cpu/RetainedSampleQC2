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

async function main() {
  console.log('Reading all records to compute counts...');
  console.log('(select() keeps this light — only fetches the two fields needed)');

  const snap = await db.collection('records').select('group', 'deleted').get();
  console.log(`Scanned ${snap.size} documents.`);

  const groups = { FG: 0, SF: 0, Filling: 0 };
  let total = 0;
  let softDeleted = 0;
  let unknownGroup = 0;

  snap.forEach(doc => {
    const d = doc.data();
    if (d.deleted) { softDeleted++; return; }
    total++;
    if (groups[d.group] != null) groups[d.group]++;
    else unknownGroup++;
  });

  console.log('\n--- Computed ---');
  console.log(`Active records : ${total}`);
  console.log(`  FG           : ${groups.FG}`);
  console.log(`  SF           : ${groups.SF}`);
  console.log(`  Filling      : ${groups.Filling}`);
  if (unknownGroup) console.log(`  (unrecognised group value: ${unknownGroup})`);
  if (softDeleted) console.log(`Soft-deleted   : ${softDeleted} (excluded from counts)`);

  await db.collection('meta').doc('stats').set({
    total,
    groups,
    updatedAt: new Date().toISOString(),
  });

  console.log('\nWrote meta/stats. Reload the app — the dashboard should now show these numbers.');
}

main().catch(err => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
