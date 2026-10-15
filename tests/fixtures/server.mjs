// A local HTTP server with the PDF cases the extension must handle. Used by tests/e2e and for
// manual testing: `node tests/fixtures/server.mjs` then open http://127.0.0.1:8790/.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { makePdf } from './make-pdf.mjs';

const pdf = makePdf({ pages: 3, title: 'PdfCraft fixture' });
const large = makePdf({ pages: 200, title: 'Large fixture', padding: 24 * 1024 * 1024 });
const garbage = Buffer.from('<html><body>Not a PDF at all, despite the name.</body></html>');

const pages = {
  '/': `<h1>PdfCraft fixtures</h1><ul>
    <li><a id="direct" href="/doc.pdf">Direct PDF</a></li>
    <li><a id="blank" href="/doc.pdf" target="_blank">Direct PDF in a new tab</a></li>
    <li><a href="/redirect.pdf">302 redirect to a PDF</a></li>
    <li><a href="/no-extension">PDF without .pdf in the path</a></li>
    <li><a href="/octet.pdf">PDF sent as application/octet-stream</a></li>
    <li><a href="/plain.pdf">PDF sent as text/plain</a></li>
    <li><a href="/attachment.pdf">PDF sent as an attachment</a></li>
    <li><a href="/missing.pdf">404</a></li>
    <li><a href="/protected.pdf">401 protected</a></li>
    <li><a href="/malformed.pdf">Not really a PDF (HTML with a PDF content type)</a></li>
    <li><a href="/large.pdf">Large PDF (about 24 MB, 200 pages)</a></li>
    <li><a href="/query.pdf?a=1&amp;b=two#page=2">PDF with query and fragment</a></li>
    <li><a href="/embed.html">Embedded with &lt;embed&gt;</a></li>
    <li><a href="/iframe.html">Embedded with &lt;iframe&gt;</a></li>
    <li><a href="/object.html">Embedded with &lt;object&gt;</a></li>
  </ul>`,
  '/embed.html': '<h1>Embed</h1><embed id="pdf" src="/doc.pdf" type="application/pdf" width="600" height="400">',
  '/iframe.html': '<h1>Iframe</h1><iframe id="pdf" src="/doc.pdf" width="600" height="400"></iframe>',
  '/object.html': '<h1>Object</h1><object id="pdf" data="/doc.pdf" type="application/pdf" width="600" height="400"></object>',
};

export function startFixtureServer(port = 0) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-store', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (pages[path]) return send(200, 'text/html; charset=utf-8', Buffer.from(`<!doctype html><meta charset="utf-8"><title>${path}</title>${pages[path]}`));
    switch (path) {
      case '/doc.pdf':
      case '/query.pdf':
        return send(200, 'application/pdf', pdf);
      case '/no-extension':
        return send(200, 'application/pdf', pdf);
      case '/redirect.pdf':
        res.writeHead(302, { location: '/doc.pdf' });
        return res.end();
      case '/octet.pdf':
        return send(200, 'application/octet-stream', pdf);
      case '/plain.pdf':
        return send(200, 'text/plain', pdf);
      case '/attachment.pdf':
        return send(200, 'application/pdf', pdf, { 'content-disposition': 'attachment; filename="attached.pdf"' });
      case '/named':
        return send(200, 'application/pdf', pdf, { 'content-disposition': 'inline; filename="Quarterly report.pdf"' });
      case '/protected.pdf':
        return send(401, 'text/html', Buffer.from('<h1>Sign in required</h1>'), { 'www-authenticate': 'Bearer' });
      case '/malformed.pdf':
        return send(200, 'application/pdf', garbage);
      case '/large.pdf':
        return send(200, 'application/pdf', large);
      default:
        return send(404, 'text/html', Buffer.from('<h1>Not found</h1>'));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${actual}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { origin } = await startFixtureServer(Number(process.env.PORT) || 8790);
  console.log(`fixtures on ${origin}/`);
}
