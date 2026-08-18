#!/usr/bin/env node
/**
 * predeploy_check.mjs
 *
 * Run this BEFORE every `git push` / Firebase deploy:
 *
 *   node predeploy_check.mjs
 *
 * It reproduces the exact two checks that decide whether QC2.dc.html will
 * load in the browser:
 *
 *   1. The dc-runtime's own compile step for <script data-dc-script>
 *      (support.js's evalDcLogic) — this is what threw "Root: Unexpected
 *      token ';'" in production. If this check passes here, it will pass
 *      in the browser too, because it's the identical code path.
 *
 *   2. A scan for "smart" typographic characters (curly quotes, etc.)
 *      that look identical to normal quotes in most editors but silently
 *      break JS string/template boundaries. These get introduced by
 *      copy-pasting through Word, Notes apps, some mobile keyboards, or
 *      GitHub's web editor's autocomplete — NOT by git or a plain text
 *      editor. If this script is ever run on a file straight from git and
 *      it fails, the corruption happened during hand-editing, not in transit.
 *
 * Exit code 0 = safe to deploy. Exit code 1 = DO NOT deploy, fix first.
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const FILES = ['QC2.dc.html', 'qc2-store.js'];
let failed = false;

function checkDcScript(html, filename) {
  const marker = 'data-dc-script';
  const start = html.indexOf(marker);
  if (start === -1) return; // not the file with the logic block

  const tagEnd = html.indexOf('>', start) + 1;
  const scriptEnd = html.indexOf('</script>', tagEnd);
  if (tagEnd <= 0 || scriptEnd === -1) {
    console.log(`❌ ${filename}: could not locate <script data-dc-script> ... </script> block cleanly`);
    failed = true;
    return;
  }

  const src = html.slice(tagEnd, scriptEnd);

  try {
    // This line MUST match support.js's evalDcLogic exactly — if the
    // vendor file is ever upgraded, diff its evalDcLogic against this.
    new Function(
      'DCLogic', 'StreamableLogic', 'React',
      src + '\n;return (typeof Component!=="undefined"&&Component)||undefined;'
    );
    console.log(`✅ ${filename}: <script data-dc-script> compiles (matches runtime's evalDcLogic exactly)`);
  } catch (e) {
    console.log(`❌ ${filename}: ${e.constructor.name}: ${e.message}`);
    console.log(`   This is exactly the error the browser will show, prefixed with "Root: ".`);
    failed = true;
  }
}

function checkJsSyntax(filename) {
  // new Function() can't parse `export`/`import` (ES module syntax), so we
  // shell out to `node --check`, which understands modules correctly.
  const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
  if (result.status === 0) {
    console.log(`✅ ${filename}: valid JS syntax (ES module)`);
  } else {
    console.log(`❌ ${filename}: ${(result.stderr || '').trim()}`);
    failed = true;
  }
}

const RISKY_CHARS = {
  '\u2018': 'left smart single quote  \u2018 (should be \')',
  '\u2019': 'right smart single quote \u2019 (should be \')',
  '\u201C': 'left smart double quote  \u201C (should be ")',
  '\u201D': 'right smart double quote \u201D (should be ")',
};

function checkSmartQuotes(txt, filename) {
  let found = false;
  for (const [ch, label] of Object.entries(RISKY_CHARS)) {
    const count = txt.split(ch).length - 1;
    if (count) {
      if (!found) { console.log(`⚠️  ${filename}: smart-quote characters found (common corruption source):`); found = true; }
      console.log(`   ${label} — x${count}`);
      failed = true;
    }
  }
  if (!found) console.log(`✅ ${filename}: no smart-quote corruption detected`);
}

function checkTagBalance(html, filename) {
  const pairs = [
    ['div', '</div>'], ['sc-if', '</sc-if>'], ['sc-for', '</sc-for>'],
    ['td', '</td>'], ['tr', '</tr>'], ['button', '</button>'],
  ];
  let ok = true;
  for (const [tag, close] of pairs) {
    const openCount = (html.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
    const closeCount = (html.match(new RegExp(close.replace('/', '\\/'), 'g')) || []).length;
    if (openCount !== closeCount) {
      console.log(`❌ ${filename}: <${tag}> mismatch — ${openCount} open vs ${closeCount} close`);
      ok = false;
      failed = true;
    }
  }
  if (ok) console.log(`✅ ${filename}: all tracked tags balanced`);
}

console.log('Running pre-deploy checks...\n');

for (const file of FILES) {
  if (!fs.existsSync(file)) {
    console.log(`⚠️  ${file}: not found, skipping`);
    continue;
  }
  const txt = fs.readFileSync(file, 'utf8');
  console.log(`--- ${file} ---`);

  if (file.endsWith('.html')) {
    checkDcScript(txt, file);
    checkTagBalance(txt, file);
  } else {
    checkJsSyntax(file);
  }
  checkSmartQuotes(txt, file);
  console.log('');
}

if (failed) {
  console.log('❌ FAILED — do not deploy. Fix the issues above first.');
  process.exit(1);
} else {
  console.log('✅ All checks passed — safe to git push / firebase deploy.');
  process.exit(0);
}
