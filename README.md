# RetainedSampleQC2 — QC Retained Sample Database

A modern, scalable web application for managing QC (Quality Control) retained sample records. RetainedSampleQC2 migrates legacy Access databases into a cloud-native system built on Firebase, designed to handle hundreds of thousands of records with real-time search, filtering, loan tracking, and automated reporting.

## What Is It?

RetainedSampleQC2 tracks physical retained samples stored for quality control purposes — typically batches of raw materials, intermediate products, or finished goods kept for verification, testing, or compliance. The system maintains a complete audit trail of:

- **Sample metadata**: batch number, product code, box location, entry date, group classification (FG/SF/Filling)
- **Loan status**: who borrowed what, when, for how long — with automatic overdue flagging
- **Data integrity**: placeholder batch detection, duplicate prevention, soft-delete with undelete capability
- **Historical records**: 10+ years of sample data, searchable across multiple time windows (30 days to all time)

## Key Features

### Real-Time Search & Filtering
- **Multi-field prefix search** across batch numbers, product codes, and box locations
- **Tiered time windows** (30/60/120 days, 1/3/5/10 years, all time) to keep results fast even at scale
- **Case-insensitive matching** — type `sf66p` or `SF66P`, both work
- **Live duplicate prevention** — sees if a batch already exists as you type
- **Truncation warnings** — tells you if results were truncated so you know to narrow the search

### Loan & Status Tracking (Dipinjam)
- Mark samples as borrowed with borrower name, date, and optional notes
- Track aging: shows how many days a sample has been out, flags overdue (>30 days by default)
- Instant return: mark returned samples and restore their status to "Tersedia"
- Filtered view: see only borrowed samples with built-time-window + status filtering

### Dashboard & Analytics
- **Live entry counts** with month-over-month trend (↑/↓ indicators)
- **Product group breakdown** (FG/SF/Filling) with click-through filtering
- **Status distribution** (Tersedia/Dipinjam) with aging visibility
- **Data quality flag** — surface placeholder batch numbers for cleanup passes
- **Recent entries** — newest 8 samples for quick verification

### Print & Export
- **Print by box** — offline PDF export of all samples in a storage box
- **Print by batch/code** — ad-hoc reports grouped by product
- **CSV export** — download filtered views for spreadsheet analysis
- All print templates styled for both desktop and mobile

### Automated Stats Maintenance
- **Weekly scheduled rebuild** (Monday 3:00 AM Jakarta time) via Cloud Scheduler
- Keeps dashboard numbers accurate even when records are deleted
- Manual trigger available for immediate recalculation
- Self-healing: no memory drift over time

### Mobile-First Design
- **Responsive layout** for phones, tablets, and desktops
- Drawer navigation on small screens, drawer drawer sidebar on desktop
- Touch-friendly buttons and input fields (48px minimum)
- Offline capability via Service Worker for cached data

---

## Architecture

### Frontend
- **Framework**: Custom `dc-runtime` (React-like, single-page architecture)
- **File**: `QC2.dc.html` (~2,000 lines, self-contained)
- **Language**: Indonesian UI labels, bilingual documentation

### Backend & Database
- **Hosting**: Firebase App Hosting (Cloud Run, auto-scaling)
- **Database**: Firestore (default region, nam5)
- **Auth**: App Check (no user login required; internal network access only)
- **Indexes**: 9 composite indexes optimized for group/status/date/sort combinations

### Data Layer
- **Local state**: `qc2-store.js` (~1,000 lines) — IndexedDB + Firestore hybrid
- **Data access pattern**: Server-side paginated queries (165k records too large for client-side loading)
- **Stats caching**: `meta/stats` document for O(1) dashboard metrics

### Automation
- **Scheduled job**: `functions/` — Cloud Function running weekly rebuild
- **Manual trigger**: HTTP endpoint for on-demand recalculation
- **Monitoring**: Firebase Cloud Logging

---

## Deployment

### Prerequisites
- Google Cloud project with Blaze (pay-as-you-go) plan billing enabled
- Firebase CLI installed (`npm install -g firebase-tools`)
- Service account key with Firestore access

### Quick Start

1. **Clone and navigate to the project**
   ```bash
   git clone https://github.com/your-org/RetainedSampleQC2.git
   cd RetainedSampleQC2
   ```

2. **Set up Firebase credentials**
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
   firebase login
   firebase use retainedsampleqc2
   ```

3. **Deploy everything at once**
   ```bash
   # Front-end, Firestore rules, indexes, and Cloud Functions
   firebase deploy
   ```

4. **Deploy only specific components**
   ```bash
   firebase deploy --only hosting              # Front-end only
   firebase deploy --only functions            # Cloud Functions only
   firebase deploy --only firestore:rules      # Security rules only
   firebase deploy --only firestore:indexes    # Composite indexes only
   ```

5. **Verify deployment**
   - Open `https://studio-XXXX-YYYY.web.app/` (URL shown in deploy output)
   - Dashboard should load with entry counts and recent samples
   - Search should work for existing batch numbers

### Importing Historical Data

If migrating from an Access database:

1. **Export from Access** as CSV or use `mdbtools` for `.mdb` file extraction
2. **Clean and normalize** the data (remove duplicates, fix date formats)
3. **Run the import script**
   ```bash
   node import_to_firestore.mjs
   ```
   - Imports up to 165k records in idempotent 450-operation chunks
   - Can be safely re-run without duplicating

4. **Rebuild stats**
   ```bash
   node rebuild_stats.mjs
   ```
   - Computes accurate counts for dashboard
   - ~5 seconds for 165k records

### Manual Stats Recalculation

If you've deleted a lot of records and dashboard counts drift:

```bash
# Option 1: Local script
node rebuild_stats.mjs

# Option 2: Cloud Function trigger
curl -X POST https://your-function-url/rebuildStatsNow
```

---

## Usage Guide

### Entering New Samples
1. Click **"Entri baru"** (top-left of banner)
2. Fill in: Date, Product Code, Batch No., Box, Group (auto-filled from batch pattern)
3. Press Enter or click Save
4. System checks for duplicates in real-time, blocks if batch already exists

### Searching
1. Click **"Cari"** button or press **⌘K**
2. Type batch number, product code, or box (case-insensitive, prefix-matching)
3. Click time-window chip to adjust search range (default: last 1 year)
4. Results appear newest-first; click a row to view details

### Marking Samples as Borrowed
1. Open Records page
2. Click **"Dipinjam"** button on a row, or select multiple rows and use bulk action
3. Enter borrower name, date, optional notes
4. Status changes to "Dipinjam", aging counter starts

### Returning Borrowed Samples
1. Go to **"Dipinjam"** sidebar menu to filter only borrowed samples
2. Click **"Return"** on a row (or select multiple)
3. Enter return date and optional notes
4. Status restores to "Tersedia", sample moves off the loan list

### Printing
- **Print by box**: Sidebar > "Cetak" > select recent box > Export PDF
- **Print current filter**: Records page > "Print report" button
- **Export to CSV**: Records page > "Export this view (CSV)" button

### Loan Auditing
- **Dipinjam view**: Shows all borrowed samples with days-out counter
- **Overdue flag (⚠️)**: Appears on samples >30 days out (configurable)
- **Borrower tracking**: Click any overdue sample to see who borrowed it and when

---

## Configuration

### Adjustable Settings

Edit constants in `QC2.dc.html`:

- **`LOAN_OVERDUE_DAYS`** (line ~842): Days threshold for overdue flag (default: 30)
- **`SEARCH_WINDOWS`** (line ~850): Available time windows for search filtering
- **`SEARCH_WINDOW_LABEL`** (line ~859): Indonesian labels for each window

Edit Cloud Function schedule in `functions/index.js`:

- **`schedule`**: Cron-like format (default: `'every monday 03:00'`)
- **`timeZone`**: IANA timezone (default: `'Asia/Jakarta'`)
- **`memory`**: RAM for Cloud Function (default: `'256MiB'`)

### Firestore Security Rules

Default rules in `firestore.rules` allow all read/write access for internal use. For production:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Restrict to App Check verified requests
    match /{document=**} {
      allow read, write: if request.auth.uid != null && request.appCheck.enabled;
    }
  }
}
```

---

## Troubleshooting

### Search Returns Nothing
- **Check search window**: Narrow windows might exclude older data
- **Verify batch format**: Product codes are case-sensitive; `SF66p` and `sf66p` both work, but `66SF` won't match `SF66`
- **Check date range**: Use "Semua" to search all time

### Dashboard Shows "Loading…" or Blank Counts
- Rebuild stats: `node rebuild_stats.mjs` or trigger via Cloud Function
- Refresh the page (full hard-refresh: **Ctrl+Shift+R** on Windows, **Cmd+Shift+R** on Mac)

### Loan Status Won't Save
- Ensure you're on Records page in server mode (not offline)
- Try clicking the row again to fetch fresh data

### Slow Search on Large Batches
- Narrow the search window (e.g., "1 thn" instead of "Semua")
- Use more specific prefixes (e.g., `SF1` instead of `SF`)
- Check browser console for Firestore errors

---

## Technical Notes

### Data Schema

Each record contains:
```javascript
{
  id: string,              // unique identifier
  date: string,            // ISO 8601 date (YYYY-MM-DD)
  batch: string,           // normalized uppercase, natural primary key
  code: string,            // product code
  box: string,             // storage box identifier
  group: string,           // 'FG' | 'SF' | 'Filling' (auto-derived from batch)
  status: string,          // 'ok' | 'borrowed' | 'lost' | 'destroyed'
  loans: array,            // [{by, out, back, note}, ...]
  statusAt: string,        // ISO 8601 timestamp when status last changed
  statusNote: string,      // reason for status change
  updatedAt: string,       // ISO 8601 timestamp of last update
  deleted: boolean,        // soft-delete flag
}
```

### Firestore Collections

- **`records`** — 165k+ sample documents, paginated queries only
- **`meta/stats`** — dashboard counts, rebuilt weekly (or on-demand)
- **`audit`** — future: change log and user activity tracking

### Indexes

9 composite indexes cover all search+sort combinations with group/status filtering. Replicated across queries to keep latency <500ms even at scale.

---

## Security & Privacy

- **No authentication required** — assumes internal network use (office network, VPN)
- **All reads/writes go to Firestore** — local state is a cache only, not authoritative
- **Soft-delete pattern** — records marked `deleted: true` are excluded from views, never hard-deleted
- **Audit trail** (planned) — log all status changes and deletions for compliance
- **Export controls** — data stays in Google Cloud, region-locked to nam5

---

## Support & Contributing

For bugs, feature requests, or deployment issues:

1. Check the troubleshooting section above
2. Review Firebase Cloud Logging for errors
3. Open an issue with details: browser, Firebase project, error message

For development:

1. Fork the repo
2. Edit `QC2.dc.html` and `qc2-store.js` locally
3. Test on staging Firebase project
4. Submit PR with clear description of changes

---

## License & Attribution

RetainedSampleQC2 migrates legacy Microsoft Access retained-sample databases into a modern cloud system. Built with Firebase, optimized for 165k+ records, and designed for manufacturing/QC teams.

**Version:** 2026-08-18  
**Author:** Your organization  
**Maintenance:** Weekly automated stats rebuild, monthly security reviews recommended
