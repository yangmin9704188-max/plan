import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StateStore, InputError } from './lib/state.mjs';
import { createGithubClient } from './lib/github.mjs';
import { createBoard } from './lib/board.mjs';
import { createMenuBoard } from './lib/menu-board.mjs';
import { isValidRepo } from './lib/features.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const execFileAsync = promisify(execFile);

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function bodyJson(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new InputError('application/json 형식으로 보내주세요.', 415);
  }
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data, 'utf8') > 64 * 1024) throw new InputError('요청 크기가 너무 큽니다.', 413);
  }
  try { return JSON.parse(data); }
  catch { throw new InputError('JSON 형식이 올바르지 않습니다.'); }
}

function assertLocalRequest(req) {
  const hostname = (req.headers.host || '').split(':')[0];
  if (!['127.0.0.1', 'localhost'].includes(hostname)) throw new InputError('로컬 접속만 지원합니다.', 403);
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname); } catch { ok = false; }
    if (!ok) throw new InputError('허용되지 않은 요청 출처입니다.', 403);
  }
}

export function sourceFromEnv(env = process.env) {
  if (env.FEATURES_LOCAL_DIR) return { localDir: resolve(ROOT, env.FEATURES_LOCAL_DIR) };
  const repo = env.FEATURES_REPO || 'yangmin9704188-max/plan';
  if (!isValidRepo(repo)) throw new Error('FEATURES_REPO는 owner/repo 형식이어야 합니다.');
  return { repo, dir: env.FEATURES_DIR || 'features', ref: env.FEATURES_REF || 'main' };
}

// 메뉴별 기능 카드: Office 저장소의 docs/feature-cards (개발 브랜치 기준).
export function cardsSourceFromEnv(env = process.env) {
  if (env.CARDS_LOCAL_DIR) return { localDir: resolve(ROOT, env.CARDS_LOCAL_DIR) };
  const repo = env.CARDS_REPO || 'yangmin9704188-max/jakupan_office_web';
  if (!isValidRepo(repo)) throw new Error('CARDS_REPO는 owner/repo 형식이어야 합니다.');
  return { repo, dir: env.CARDS_DIR || 'docs/feature-cards', ref: env.CARDS_REF || 'codex/office-performance-investigation-20261119' };
}

export function createAppServer({
  statePath = join(ROOT, 'data', 'state.json'),
  token = process.env.GITHUB_TOKEN || '',
  fetchImpl,
  source = sourceFromEnv(),
  cardsSource = cardsSourceFromEnv()
} = {}) {
  const github = createGithubClient({ token, fetchImpl });
  const store = new StateStore(statePath);
  const board = createBoard({ github, state: store, source });
  const menuBoard = createMenuBoard({ github, state: store, source: cardsSource });
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
      const url = new URL(req.url || '/', 'http://localhost');
      const { pathname } = url;

      if (method === 'GET' && pathname === '/api/health') {
        return json(res, 200, { ok: true, githubTokenConfigured: Boolean(token), localOnly: true });
      }
      if (method === 'GET' && pathname === '/api/board') {
        return json(res, 200, await board.view(url.searchParams.get('view') === 'done' ? 'done' : 'active'));
      }
      if (method === 'POST' && pathname === '/api/refresh') {
        await board.refresh();
        return json(res, 200, await board.view(url.searchParams.get('view') === 'done' ? 'done' : 'active'));
      }
      if (method === 'GET' && pathname === '/api/menus') {
        return json(res, 200, await menuBoard.view());
      }
      if (method === 'POST' && pathname === '/api/menus/refresh') {
        await menuBoard.refresh();
        return json(res, 200, await menuBoard.view());
      }
      const cardCheck = pathname.match(/^\/api\/cards\/([^/]+)\/checks\/([^/]+)$/);
      if (method === 'PATCH' && cardCheck) {
        const saved = await menuBoard.setCheck(decodeURIComponent(cardCheck[1]), decodeURIComponent(cardCheck[2]), await bodyJson(req));
        return json(res, 200, { check: saved });
      }
      const check = pathname.match(/^\/api\/features\/([^/]+)\/checks\/([^/]+)$/);
      if (method === 'PATCH' && check) {
        const saved = await board.setCheck(decodeURIComponent(check[1]), decodeURIComponent(check[2]), await bodyJson(req));
        return json(res, 200, { check: saved });
      }
      const done = pathname.match(/^\/api\/features\/([^/]+)\/(complete|reopen)$/);
      if (method === 'POST' && done) {
        const saved = await board.setCompleted(decodeURIComponent(done[1]), done[2] === 'complete');
        return json(res, 200, { completedAt: saved.completedAt });
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
      const status = error.statusCode || 500;
      if (status === 500) console.error('[server] request failed:', error);
      return json(res, status, { error: status === 500 ? '서버 오류가 발생했습니다.' : error.message });
    }
  };

  return createServer(handler);
}

// Falls back to the GitHub CLI login so no separate token is needed.
// The token stays in memory only; the dashboard still makes read-only calls.
export async function resolveToken(env = process.env, run = execFileAsync) {
  if (env.GITHUB_TOKEN) return { token: env.GITHUB_TOKEN, source: '.env 토큰' };
  if (env.GITHUB_TOKEN_FROM_GH === '0') return { token: '', source: '' };
  try {
    const { stdout } = await run('gh', ['auth', 'token'], { timeout: 10_000, windowsHide: true });
    const token = stdout.trim();
    return token ? { token, source: 'gh 로그인' } : { token: '', source: '' };
  } catch {
    return { token: '', source: '' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile?.(join(ROOT, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const port = Number(process.env.PORT || '4400');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT는 1~65535 범위여야 합니다.');
  const source = sourceFromEnv();
  const cardsSource = cardsSourceFromEnv();
  const { token, source: tokenSource } = await resolveToken();
  createAppServer({ token, source, cardsSource }).listen(port, '127.0.0.1', () => {
    console.log(`작업판 개발 대시보드: http://127.0.0.1:${port}`);
    console.log('기능 파일:', source.localDir || `${source.repo}/${source.dir} (${source.ref})`);
    console.log('기능 카드:', cardsSource.localDir || `${cardsSource.repo}/${cardsSource.dir} (${cardsSource.ref})`);
    console.log('GitHub 연결:', token ? tokenSource : '토큰 없음 · 공개 저장소만 조회 가능 (gh auth login 또는 .env의 GITHUB_TOKEN)');
  });
}
