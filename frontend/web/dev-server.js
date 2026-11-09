const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5173;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname === '/' || pathname === '/login') {
    pathname = '/index.html';
  } else if (pathname === '/register') {
    pathname = '/register.html';
  } else if (pathname === '/verify-otp') {
    pathname = '/verify-otp.html';
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 - Halaman Tidak Ditemukan</h1><p><a href="/">Kembali ke Login</a></p>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Server Error: ${err.code}`);
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n======================================================');
  console.log('  🚀 Absensi PIA - Web Frontend Dev Server Aktif!');
  console.log('======================================================');
  console.log(`  ➜ Halaman Login      : http://localhost:${PORT}/`);
  console.log(`  ➜ Halaman Registrasi : http://localhost:${PORT}/register.html`);
  console.log(`  ➜ Halaman OTP Email  : http://localhost:${PORT}/verify-otp.html`);
  console.log('======================================================\n');
});

