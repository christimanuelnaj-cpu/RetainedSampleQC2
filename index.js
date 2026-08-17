// Weekly self-healing job for meta/stats.
//
// Why this exists: putMany() adjusts the stats counters live when records
// are added or their loan status changes, but a deleted record does NOT
// decrement them (deciding what a "delete" even means for historical
// stats is a judgment call, so we deliberately didn't guess). Over time
// that drifts the dashboard numbers slightly high. Rather than chase every
// possible write path, this just recomputes meta/stats from scratch on a
// schedule, the same way rebuild_stats.mjs does by hand.
//
// Deploy: firebase deploy --only functions --project retainedsampleqc2
// Requires the Blaze (pay-as-you-go) plan — Cloud Scheduler needs billing
// enabled even though a once-a-week run stays comfortably inside the free
// tier (2M function invocations/month, 3 free scheduler jobs).
//
// To change the schedule or time zone, edit the `schedule` / `timeZone`
// fields below and redeploy.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

// Same placeholder-batch check as qc2-store.js and rebuild_stats.mjs —
// kept in sync deliberately across all three copies.
function normBatch(v) {
  return (v || '').trim().replace(/\s+/g, ' ').toUpperCase();
}
function isPlaceholderBatch(v) {
  const b = normBatch(v);
  return !b || /^[-–—]+$/.test(b) || b === 'NOBATCH' || b === 'NO BATCH';
}

async function rebuildStats() {
  const db = getFirestore();
  const groups = { FG: 0, SF: 0, Filling: 0 };
  const statuses = { ok: 0, borrowed: 0 };
  const boxes = new Set();
  const codes = new Set();
  let total = 0;
  let placeholderBatchCount = 0;
  let scanned = 0;
  let cursor = null;
  const PAGE = 5000; // paginated the same way rebuild_stats.mjs is, well under any deadline

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
      if (d.deleted) return;
      total++;
      if (groups[d.group] != null) groups[d.group]++;
      const st = d.status || 'ok';
      statuses[st] = (statuses[st] || 0) + 1;
      if (d.box) boxes.add(d.box);
      if (d.code) codes.add(d.code);
      if (isPlaceholderBatch(d.batch)) placeholderBatchCount++;
    });

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break; // last page
  }

  const stats = {
    total, groups, statuses,
    boxCount: boxes.size, codeCount: codes.size,
    placeholderBatchCount,
    updatedAt: new Date().toISOString(),
  };
  await db.collection('meta').doc('stats').set(stats);
  console.log(`Stats rebuilt: ${scanned} scanned, ${total} active. groups=${JSON.stringify(groups)} statuses=${JSON.stringify(statuses)}`);
  return stats;
}

// Runs automatically every Monday at 03:00 WIB (Jakarta time — quiet hours,
// won't compete with daytime usage). Cloud Scheduler is created and wired
// up automatically the first time this deploys; no manual console steps.
exports.weeklyStatsRebuild = onSchedule(
  { schedule: 'every monday 03:00', timeZone: 'Asia/Jakarta', timeoutSeconds: 540, memory: '256MiB' },
  async () => { await rebuildStats(); }
);

// Manual trigger for the same job — handy for testing the deploy without
// waiting for Monday, or forcing a recount right after a big cleanup.
// Not linked from the app UI on purpose (an unauthenticated HTTPS endpoint
// that rewrites meta/stats shouldn't be casually discoverable) — call it
// directly with its Cloud Run URL from the Firebase console or curl when
// you need it.
exports.rebuildStatsNow = onRequest(
  { timeoutSeconds: 540, memory: '256MiB' },
  async (req, res) => {
    try {
      const stats = await rebuildStats();
      res.status(200).json({ ok: true, stats });
    } catch (e) {
      console.error('rebuildStatsNow failed:', e);
      res.status(500).json({ ok: false, error: String(e && e.message || e) });
    }
  }
);
