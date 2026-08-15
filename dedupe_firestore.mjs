// Deduplication script — removes duplicate records from Firestore.
// The canonical record for each unique (date|box|batch|code) combination
// is the one with an `imp_` prefixed ID (written by the Admin SDK import).
// Browser-written records with random IDs that duplicate the same key
// are deleted.
//
// Run in Cloud Shell:
//   node dedupe_firestore.mjs

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = initializeApp({ credential: applicationDefault() });
const db = getFirestore(app);

function makeKey(r) {
  return `${r.date || ''}|${(r.box || '').trim()}|${(r.batch || '').trim().toUpperCase()}|${(r.code || '').trim()}`;
}

async function main() {
  console.log('Reading all records from Firestore...');
  console.log('(This may take a minute for 491k documents)');

  const snap = await db.collection('records').get();
  console.log(`Total documents: ${snap.size}`);

  // Group by the natural key — keep imp_ prefixed ID as canonical,
  // or if no imp_ exists for a key, keep the first one seen.
  const canonical = new Map(); // key -> docId to KEEP
  const toDelete = [];         // docIds to DELETE

  snap.forEach(doc => {
    const data = doc.data();
    if (data.deleted) {
      // Soft-deleted records: keep one, delete the rest
    }
    const key = makeKey(data);
    const existing = canonical.get(key);

    if (!existing) {
      canonical.set(key, doc.id);
    } else {
      // Prefer imp_ prefixed (Admin SDK import) over random browser IDs
      const existingIsImp = existing.startsWith('imp_');
      const thisIsImp = doc.id.startsWith('imp_');

      if (thisIsImp && !existingIsImp) {
        // This one is better — delete the existing, keep this
        toDelete.push(existing);
        canonical.set(key, doc.id);
      } else {
        // Existing is better or equal — delete this one
        toDelete.push(doc.id);
      }
    }
  });

  console.log(`\nUnique records: ${canonical.size}`);
  console.log(`Duplicates to delete: ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log('No duplicates found — nothing to do.');
    return;
  }

  console.log('\nDeleting duplicates in batches...');
  const CHUNK = 500;
  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const slice = toDelete.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const id of slice) {
      batch.delete(db.collection('records').doc(id));
    }
    try {
      await batch.commit();
      deleted += slice.length;
      if (deleted % 5000 === 0 || deleted === toDelete.length) {
        console.log(`Deleted ${deleted} / ${toDelete.length}...`);
      }
    } catch (e) {
      console.error(`Batch delete failed at offset ${i}:`, e.message);
      failed += slice.length;
    }
  }

  console.log(`\nDone. Deleted: ${deleted}, failed: ${failed}`);

  // Verify final count
  const finalSnap = await db.collection('records').count().get()
    .catch(async () => {
      // count() not available in all SDK versions
      const s = await db.collection('records').limit(200000).get();
      return { data: () => ({ count: s.size }) };
    });
  console.log(`Final document count: ${finalSnap.data().count}`);
  console.log(`Expected: ~${canonical.size}`);
}

main().catch(err => {
  console.error('Deduplication failed:', err.message || err);
  process.exit(1);
});
