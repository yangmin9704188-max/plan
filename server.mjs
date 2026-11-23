import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileStore, InputError } from './lib/store.mjs';
import { createGithubClient } from './lib/github.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(ROOT, 'public');

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

async function bodyJson(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw invalid('application/json 형식으로 보내주세요.', 415);
  }
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data, 'utf8') > 1024 * 1024) throw invalid('요청 크기가 너무 큽니다.', 413);
  }
  try { return JSON.parse(data); }
  catch { throw invalid('JSON 형식이 올바르지 않습니다.'); }
}

function assertLocalRequest(req) {
  const hostname = (req.headers.host || '').split(':')[0];
  if (!['127.0.0.1', 'localhost'].includes(hostname)) throw invalid('로컬 접속만 지원합니다.', 403);
  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error();
    } catch { throw invalid('허용되지 않은 요청 출처입니다.', 403); }
  }
}

export function createAppServer({ dataPath = join(ROOT, 'data', 'features.json'), token = process.env.GITHUB_TOKEN || '', fetchImpl } = {}) {
  const store = new FileStore(dataPath);
  const github = createGithubClient({ token, fetchImpl });
  const assets = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml']
  };

  const handler = async (req, res) => {
    try {
      assertLocalRequest(req);
      const method = req.method || 'GET';
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      const writeMethod = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
      if (writeMethod) assertLocalRequest(req);

      if (method === 'GET' && pathname === '/api/health') {
        return json(res, 200, { ok: true, githubTokenConfigured: Boolean(token), localOnly: true });
      }
      if (method === 'GET' && pathname === '/api/features') {
        return json(res, 200, { features: await store.list() });
      }
      if (method === 'POST' && pathname === '/api/features') {
        return json(res, 201, { feature: await store.create(await bodyJson(req)) });
      }
      if (method === 'GET' && pathname === '/api/progress') {
        const refresh = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1';
        const features = await store.list();
        // Keep rate limits and UI latency bounded. No background workers or task state.
        const progress = [];
        for (let index = 0; index < features.length; index += 4) {
          progress.push(...await Promise.all(features.slice(index, index + 4).map((feature) => github.resolveFeature(feature, { refresh }))));
        }
        return json(res, 200, { progress });
      }

      const check = pathname.match(/^\/api\/features\/([^/]+)\/checks\/([^/]+)$/);
      if (method === 'PATCH' && check) {
        const feature = await store.updateCheck(check[1], check[2], await bodyJson(req));
        return json(res, 200, { feature });
      }
      const feature = pathname.match(/^\/api\/features\/([^/]+)$/);
      if (method === 'PATCH' && feature) {
        return json(res, 200, { feature: await store.update(feature[1], await bodyJson(req)) });
      }
      if (method === 'DELETE' && feature) {
        return json(res, 200, { feature: await store.remove(feature[1]) });
      }

      if (method === 'GET' && assets[pathname]) {
        const [filename, contentType] = assets[pathname];
        const body = await readFile(join(PUBLIC, filename));
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer'
        });
        return res.end(body);
      }
      return json(res, 404, { error: '경로를 찾을 수 없습니다.' });
    } catch (error) {
      const status = error.statusCode || (error instanceof InputError ? 400 : 500);
      if (status === 500) console.error('[server] request failed:', error.name);
      return json(res, status, { error: status === 500 ? '서버 오류가 발생했습니다.' : error.message });
    }
  };

  return createServer(handler);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile?.(join(ROOT, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Evaluate the env after loading .env; createAppServer otherwise uses supplied options.
  const port = Number(process.env.PORT || '4400');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT는 1~65535 범위여야 합니다.');
  createAppServer({ token: process.env.GITHUB_TOKEN || '' }).listen(port, '127.0.0.1', () => {
    console.log(`작업판 개발 진행표: http://127.0.0.1:${port}`);
    console.log('GitHub 연결:', process.env.GITHUB_TOKEN ? '개인 토큰 사용' : '공개 저장소만 조회 가능');
  });
}