const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const CLIPDROP_API_KEY = process.env.CLIPDROP_API_KEY;
const PORT = 8080;

async function handleCleanup(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const contentType = req.headers['content-type'];
  console.log('[Cleanup] Request received, body size:', body.length, 'Content-Type:', contentType);

  try {
    const response = await fetch('https://clipdrop-api.co/cleanup/v1', {
      method: 'POST',
      headers: {
        'x-api-key': CLIPDROP_API_KEY,
        'content-type': contentType,
      },
      body: body,
    });

    console.log('[Cleanup] ClipDrop response status:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Cleanup] ClipDrop error:', response.status, errText);
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: `ClipDrop error: ${response.status}`, detail: errText }));
      return;
    }

    const resultBuffer = Buffer.from(await response.arrayBuffer());
    console.log('[Cleanup] Success, result size:', resultBuffer.length);
    const ct = response.headers.get('content-type') || 'image/png';
    res.writeHead(200, {
      'Content-Type': ct,
      'Content-Disposition': 'attachment; filename="result.png"',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(resultBuffer);
  } catch (err) {
    console.error('[Cleanup] Exception:', err);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // API endpoint
  if (req.method === 'POST' && req.url === '/cleanup') {
    handleCleanup(req, res);
    return;
  }

  // 静态文件服务
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, '../frontend', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
