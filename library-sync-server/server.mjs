import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { GitHubLibrary } from './github-repository.mjs';
import { LibraryError } from './errors.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.epub': 'application/epub+zip', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

export function configuration(env = process.env) {
  const booksPath = (env.GITHUB_BOOKS_PATH || 'data/books').replace(/^\/+|\/+$/g, '');
  const config = {
    owner: env.GITHUB_OWNER || 'StellaWQL', repo: env.GITHUB_REPO || 'recipes-widget',
    branch: env.GITHUB_BRANCH || 'practice', booksPath,
    githubToken: env.GITHUB_TOKEN || '', uploadKey: env.LIBRARY_UPLOAD_KEY || '',
    host: env.HOST || '127.0.0.1', port: Number(env.PORT || 8787),
    maxBytes: Number(env.MAX_BYTES || 25 * 1024 * 1024),
    staticRoot: env.STATIC_ROOT ? resolve(env.STATIC_ROOT) : null,
    allowedOrigins: new Set(),
  };
  if (!/^[a-z\d][a-z\d-]*$/i.test(config.owner) || !/^[a-z\d_.-]+$/i.test(config.repo)
      || !config.branch || /[\s\x00-\x1f?#[\]~^:*\\]|\.\./.test(config.branch)
      || !booksPath || booksPath.split('/').some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part))) {
    throw new Error('书库服务配置的仓库、分支或目录格式不正确。');
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535
      || !Number.isInteger(config.maxBytes) || config.maxBytes < 1024 || config.maxBytes > 100 * 1024 * 1024) {
    throw new Error('PORT 或 MAX_BYTES 配置不正确。');
  }
  for (const item of String(env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean)) {
    let url;
    try { url = new URL(item); } catch { throw new Error('ALLOWED_ORIGINS 必须使用完整的网站来源地址。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== item) {
      throw new Error('ALLOWED_ORIGINS 只接受明确的网站来源，不接受通配符或带路径的地址。');
    }
    config.allowedOrigins.add(item);
  }
  // The browser receives a dedicated upload key, never the GitHub credential.
  config.enabled = !!config.githubToken && config.uploadKey.length >= 32
    && !/^(?:gh[pousr]_|github_pat_)/.test(config.uploadKey) && config.uploadKey !== config.githubToken;
  return config;
}

const hashKey = key => createHash('sha256').update(key).digest();
function authorized(request, key) {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  return timingSafeEqual(hashKey(header.slice(7)), hashKey(key));
}

function sendJson(response, code, data) {
  const body = JSON.stringify(data);
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  response.end(body);
}

async function receiveUpload(request, limit) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new LibraryError(413, 'TOO_LARGE', '这本书超过同步服务允许的大小。');
  let length = 0; const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new LibraryError(413, 'TOO_LARGE', '这本书超过同步服务允许的大小。');
    chunks.push(chunk);
  }
  if (!length) throw new LibraryError(400, 'EMPTY_FILE', '这本书是空的，请重新选择。');
  return Buffer.concat(chunks, length);
}

async function staticFile(request, response, url, root) {
  if (!root || !['GET', 'HEAD'].includes(request.method)) return false;
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return false; }
  const parts = pathname.split(/[\\/]/).filter(Boolean);
  if (parts.some(part => part.startsWith('.') || part === 'library-sync-server')) return false;
  let actualRoot, candidate;
  try {
    actualRoot = await realpath(root);
    candidate = await realpath(resolve(actualRoot, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`));
  } catch { return false; }
  if (!candidate.startsWith(`${actualRoot}${sep}`)) return false;
  const info = await stat(candidate);
  if (!info.isFile()) return false;
  response.writeHead(200, { 'Content-Type': MIME[extname(candidate).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size, 'Cache-Control': 'no-cache' });
  if (request.method === 'HEAD') response.end();
  else await pipeline(createReadStream(candidate), response);
  return true;
}

export function createLibraryServer(config, { fetchImpl = fetch } = {}) {
  const library = new GitHubLibrary(config, { fetchImpl });
  let receiving = 0;
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 60000 }, async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Vary', 'Origin');
    try {
      const url = new URL(request.url || '/', 'http://library.invalid');
      const origin = request.headers.origin;
      if (origin) {
        if (!config.allowedOrigins.has(origin)) throw new LibraryError(403, 'ORIGIN_NOT_ALLOWED', '这个网页尚未被同步服务允许连接。');
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Book-Filename');
        response.setHeader('Access-Control-Max-Age', '600');
      }
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/library/')) {
        response.writeHead(204); response.end(); return;
      }
      if (request.method === 'GET' && ['/api/library/status', '/health/status'].includes(url.pathname)) {
        sendJson(response, 200, { enabled: config.enabled, configured: config.enabled,
          maxBytes: config.maxBytes, authentication: 'bearer',
          message: config.enabled ? '书库同步服务已配置。' : '书库同步服务尚未配置完整，当前没有远程上传。' });
        return;
      }
      if (url.pathname.startsWith('/api/library/')) {
        if (!config.enabled) throw new LibraryError(503, 'NOT_CONFIGURED', '书库同步服务尚未配置完整，这本书还没有写入远程仓库。');
        if (!authorized(request, config.uploadKey)) throw new LibraryError(401, 'AUTH_REQUIRED', '请先连接你的书库同步服务。');
        if (request.method === 'GET' && url.pathname === '/api/library/books') {
          sendJson(response, 200, { books: await library.books() }); return;
        }
        const match = /^\/api\/library\/books\/([a-f0-9]{64})\/content$/.exec(url.pathname);
        if (request.method === 'GET' && match) {
          const { response: upstream, filename } = await library.content(match[1]);
          response.writeHead(200, { 'Content-Type': 'application/epub+zip', 'Cache-Control': 'private, no-store',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` });
          if (upstream.body) await pipeline(upstream.body, response);
          else response.end();
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/library/books') {
          if ((request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/epub+zip') {
            throw new LibraryError(415, 'CONTENT_TYPE', '请发送标准化后的 EPUB 文件。');
          }
          if (receiving >= 4) throw new LibraryError(429, 'UPLOAD_BUSY', '书库正在接收其他文件，请稍后重试。', true);
          let filename;
          try { filename = decodeURIComponent(request.headers['x-book-filename'] || ''); }
          catch { throw new LibraryError(400, 'INVALID_FILENAME', '书籍文件名无法读取。'); }
          receiving += 1;
          try {
            const bytes = await receiveUpload(request, config.maxBytes);
            const receipt = await library.upload(bytes, filename);
            sendJson(response, receipt.alreadyPresent ? 200 : 201, receipt);
          } finally { receiving -= 1; }
          return;
        }
        throw new LibraryError(404, 'NOT_FOUND', '没有这个书库接口。');
      }
      if (await staticFile(request, response, url, config.staticRoot)) return;
      throw new LibraryError(404, 'NOT_FOUND', '没有这个页面。');
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const known = error instanceof LibraryError;
      sendJson(response, known ? error.status : 500, { error: {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : '同步服务暂时无法完成请求，请稍后重试。',
        retryable: known ? error.retryable : true,
      } });
    }
  });
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = configuration();
    const server = createLibraryServer(config);
    server.listen(config.port, config.host, () => {
      console.log(`Library sync listening on ${config.host}:${server.address().port}`);
      console.log(config.enabled ? 'Repository sync configured; remote writes require authenticated requests.' : 'Repository sync not configured; uploads remain disabled.');
    });
    server.on('error', () => { console.error('Library sync could not start. Check the bind address and port.'); process.exitCode = 1; });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
