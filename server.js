import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let reqUrl = decodeURIComponent(req.url.split('?')[0]);
  if (reqUrl === '/' || reqUrl === '/index.html') {
    reqUrl = '/QC2.dc.html';
  }

  const filePath = path.join(__dirname, reqUrl);

  // Prevent directory traversal attacks
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const fallbackPath = path.join(__dirname, 'QC2.dc.html');
      fs.readFile(fallbackPath, (fbErr, data) => {
        if (fbErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          });
          res.end(data);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // No caching for the app shell / logic files. This is a small internal
    // tool that gets redeployed often — the cost of always revalidating is
    // nothing, but a stale cached qc2-store.js silently surviving a normal
    // refresh (looking IDENTICAL to a real bug) is exactly what happened
    // here. Static assets (images etc.) are fine to cache normally.
    const noCacheExts = ['.html', '.js', '.json'];
    const headers = { 'Content-Type': contentType };
    headers['Cache-Control'] = noCacheExts.includes(ext)
      ? 'no-store, no-cache, must-revalidate'
      : 'public, max-age=3600';

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`QC2 server running on port ${PORT}`);
});
