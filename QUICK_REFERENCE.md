# RetainedSampleQC2 — Quick Reference Card

## 🚀 Launch the App
Open: **https://studio-XXXX-YYYY.web.app/**  
Keyboard shortcut: **⌘K** (Mac) or **Ctrl+K** (Windows/Linux) → opens search palette

---

## 🔍 Search Tips

| Task | How To | Notes |
|------|-------|-------|
| Find a batch | Click **Cari** → type batch number | Case-insensitive prefix match |
| Find product | Click **Cari** → type product code | Works mid-string: `66p` finds `SF66P` |
| Find box | Click **Cari** → type box number | Matches storage locations |
| Narrow search | After searching, click time-window chip | Default: 1 tahun (1 year) |
| Search all time | Click **Semua** (All) chip | Warning: may truncate huge result sets |
| No results? | Try wider window or check spelling | Narrow windows = fast but exclude old data |

---

## 📝 Adding New Samples

| Field | Required? | Format | Auto-filled? |
|-------|-----------|--------|--------------|
| **Tanggal** (Date) | Yes | YYYY-MM-DD | Today's date |
| **Kode Produk** (Code) | Yes | Text (any case) | No |
| **No. Batch** (Batch) | Yes | Text (stored uppercase) | No |
| **No. Box** (Box) | Yes | Numeric or text | No; shows recent list |
| **Grup** (Group) | No | FG / SF / Filling | Yes (auto-derived from batch pattern) |
| **Catatan** (Notes) | No | Any text | No |

**Duplicate check**: System warns if batch already exists → must choose different batch  
**Keyboard**: Press Enter to save (faster than clicking button)

---

## 🏷️ Status & Borrowing

### Status Values
| Status | Meaning | Icon |
|--------|---------|------|
| **Tersedia** | In storage, available | ✓ Green |
| **Dipinjam** | Checked out, in use | ⏳ Orange |
| **Hilang** | Lost/missing | ✗ Red |
| **Musnah** | Destroyed/consumed | ⚠️ Dark |

### Borrowing Workflow
1. Click **"Dipinjam"** on any row
2. Fill in borrower name, date, notes
3. Status changes to "Dipinjam"; aging timer starts
4. See the sample in **Dipinjam** sidebar menu
5. Click **"Return"** when sample comes back
6. Confirm return date; status restores to "Tersedia"

### Overdue Alerts
- Loan open **>30 days** → red ⚠️ flag appears
- Hover on flag → see days elapsed and borrower name
- Configurable: edit `LOAN_OVERDUE_DAYS` in settings

---

## 📊 Dashboard

| Card | Shows | Click To |
|------|-------|----------|
| **Entries** | Total count + trend vs last month | Filter by group |
| **Status** | Tersedia vs Dipinjam bar chart | Filter by status |
| **Groups** | FG / SF / Filling breakdown | Filter by group |
| **Quality** | ⚠️ Placeholder batch count | Trigger cleanup pass |
| **Recent** | Newest 8 samples added | Open details |

**Month-over-month trend**: ↑ Green = more entries, ↓ Red = fewer entries this month

---

## 🎯 Filters & Navigation

| Control | Purpose |
|---------|---------|
| **"Dipinjam" sidebar** | Show only borrowed samples |
| **Click group bar** | Filter to FG / SF / Filling |
| **Click status bar** | Filter to Tersedia or Dipinjam |
| **"Cari" button** | Open full search palette |
| **"Records" sidebar** | Clear all filters, show everything |

---

## 🖨️ Print & Export

### Print by Box
1. Sidebar → **"Cetak"**
2. Select a box from recent list (or search)
3. Click **"Export PDF"**
4. Open/save PDF; print if needed

### Print Current Results
1. Go to **Records** page
2. Apply any filters (search, group, status)
3. Click **"Print report"** button
4. PDF shows current filtered view

### Export to CSV
1. Records page → click **"Export (CSV)"**
2. Download file to computer
3. Open in Excel, Sheets, Numbers
4. Sort/pivot/analyze as needed

---

## ⚙️ Common Tasks

### Task: Find all borrowed FG samples from last 6 months
1. Click **"Dipinjam"** in sidebar
2. Filter by status (already filtered to Dipinjam)
3. In search, click **"120d"** (120 days = ~4 months, go wider if needed)
4. Click **FG** in group breakdown
5. Results appear

### Task: Check if a batch already exists
1. Click **"Cari"**
2. Type batch number
3. System shows if it exists + details
4. Or: Enter new sample, duplicate check blocks if found

### Task: Return a borrowed sample
1. Click **"Dipinjam"** in sidebar
2. Find the sample in the list
3. Click **"Return"** button
4. Confirm return date
5. Sample moves back to Tersedia

### Task: Print all samples in Box 42 for audit
1. Sidebar → **"Cetak"**
2. Select "No. Box 42" from recent
3. Click **"Export PDF"**
4. Print or email PDF

### Task: Rebuild dashboard counts (if they look wrong)
- Contact admin to run `node rebuild_stats.mjs`
- Or: Ask admin to trigger Cloud Function manually
- Takes ~5–10 seconds; dashboard updates automatically

---

## 🔧 Tips & Tricks

| Tip | Benefit |
|-----|---------|
| **Keyboard ⌘K/Ctrl+K** | Faster than clicking "Cari" |
| **Type partial batch** | Prefix match finds it (no need for exact string) |
| **Click time-window chip** | Search speed increases 10x with narrower window |
| **Recent boxes list** | Shows boxes you've printed recently; quick reference |
| **Soft-delete undo** | Ask admin if sample was accidentally deleted (not permanently gone) |
| **Export to CSV** | Analyze trends in Excel; group by product, sum by month |
| **Mobile: zoom out** | On small phones, pinch-zoom down 75% to see more rows at once |

---

## ❌ Troubleshooting

| Problem | Try This |
|---------|----------|
| **Search shows nothing** | Try wider time window (click "Semua") |
| **Dashboard is blank** | Hard refresh (Ctrl+Shift+R / Cmd+Shift+R) or wait for weekly rebuild |
| **Duplicate check missed one** | Contact admin; may be soft-deleted — ask to check audit log |
| **Can't find old sample** | Use "Semua" (all time) window, not 1 year default |
| **App is slow** | Check internet connection; Firestore queries take ~200–500ms normally |
| **Print PDF is blank** | Try again after page fully loads; may be browser caching issue |
| **Can't borrow a sample** | Make sure you're logged in (your network is authenticated) |

---

## 📞 Support Contacts

| Issue | Contact |
|-------|---------|
| **Can't log in** | Network/VPN admin |
| **Search/print not working** | App admin (likely a cache refresh issue) |
| **Data is wrong** | Data entry team (typos in source) or admin (database issue) |
| **Feature request** | Product owner (quarterly roadmap review) |
| **Bulk import** | Admin (special script needed for large data) |

---

## 🎓 User Levels

### Beginner
- Search for samples
- View details
- Print sample list

### Intermediate
- Add new samples
- Borrow/return samples
- Filter by group/status
- Export to CSV

### Advanced
- Analyze CSV exports
- Audit overdue loans
- Request data cleanup
- Work with admins on bulk updates

---

## 📱 Mobile Differences

| Desktop | Mobile |
|---------|--------|
| Sidebar always visible | Hamburger menu (☰) to toggle |
| Full table view | Card view (stacked) |
| Date columns visible | Swipe to reveal date |
| Hover tooltips | Tap to reveal full text |
| Print via browser button | Email or save to phone notes |

**Tip:** On warehouse floor, use phone for quick lookups; full desktop for reporting.

---

## ⏰ When Data Updates

- **Real-time**: Search results, new entries, borrow/return actions
- **Every minute**: Dashboard counts (soft refresh)
- **Every Monday 03:00 Jakarta time**: Full stats rebuild (scheduled job)
- **On demand**: Ask admin to run manual rebuild if counts drift

---

## 🔐 Security & Access

- **No username/password** — your network is the auth
- **App Check**: Blocks unauthorized external access
- **Soft-delete safety**: Accidentally deleted entries are recoverable
- **Audit trail**: All loans, returns, deletions timestamped
- **Read-only offline**: If disconnected, can see cached data but not modify

---

## 📄 Help & Documentation

| Resource | Link |
|----------|------|
| **Full Guide** | README.md (project repo) |
| **Bahasa Indonesia** | README.id.md (project repo) |
| **Deployment** | Ask admin for Firebase project details |
| **Bugs / Feature requests** | GitHub issues or email product team |

---

## Version & Updates

**Current version:** 2026-08-18  
**Last updated:** August 18, 2026  
**Update frequency:** Monthly patches, quarterly feature releases

**What changed recently:**
- ✅ Fixed search to work with 165k records (was broken)
- ✅ Added time-window filtering (search faster)
- ✅ Added overdue loan alerts
- ✅ Mobile-first responsive design
- ✅ Weekly automated stats rebuild

---

**Questions? Ask your admin or check the full README.md**
