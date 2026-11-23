import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../server.mjs';
import { checkId } from '../lib/features.mjs';

const feature = `---
title: 청구서 접수
products: Office
repo: acme/office
---
## 기획
청구서를 받아 검토한다.
## 개발 계획
- 접수 기반 | branch: feat/billing-1
- 검토 화면
## 확인 항목
- 청구서를 올리면 목록에 나타나는지
`;

async function start(t) {
  const dir = await mkdtemp(join(tmpdir(), 'jakupan-board-'));
  const featuresDir = join(dir, 'features');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(featuresDir);
  await writeFile(join(featuresDir, 'billing.md'), feature);
  await writeFile(join(featuresDir, '_TEMPLATE.md'), '## 기획\n템플릿');
  let prCalls = 0;
  const server = createAppServer({
    statePath: join(dir, 'state.json'),
    token: 'testing',
    source: { localDir: featuresDir },
    fetchImpl: async () => {
      prCalls++;
      return new Response(JSON.stringify([{
        number: 7, state: 'open', merged_at: null, draft: false, html_url: 'https://github.com/acme/office/pull/7',
        head: { ref: 'feat/billing-1' }, base: { repo: { full_name: 'acme/office' } }, created_at: '2026-11-24T00:00:00Z'
      }]), { status: 200 });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}`, featuresDir, prCalls: () => prCalls };
}

const post = (url, body, headers = {}) => fetch(url, {
  method: body === undefined ? 'POST' : 'PATCH',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body)
});

test('board: reads feature files, checks, complete moves to done without PR lookups', async (t) => {
  const { base, featuresDir, prCalls } = await start(t);
  assert.match(await (await fetch(base)).text(), /개발 대시보드/);

  const board = await (await fetch(`${base}/api/board`)).json();
  assert.equal(board.features.length, 1, 'template file is skipped');
  const [item] = board.features;
  assert.equal(item.id, 'billing');
  assert.equal(item.steps[0].pr.status, 'open');
  assert.equal(item.steps[0].pr.number, 7);
  assert.equal(item.steps[1].pr.status, 'planned');
  assert.equal(prCalls(), 1, 'unlinked step does not call GitHub');

  const check = item.checks[0];
  assert.equal(check.id, checkId('청구서를 올리면 목록에 나타나는지'));
  const saved = await post(`${base}/api/features/billing/checks/${check.id}`, { result: 'issue', note: '목록에 안 보임' });
  assert.equal(saved.status, 200);
  assert.equal((await post(`${base}/api/features/billing/checks/${check.id}`, { result: 'verified-by-agent' })).status, 400);
  assert.equal((await post(`${base}/api/features/billing/checks/nope`, { result: 'pass' })).status, 404);

  // Manual refresh re-reads the file; check results stay attached by text.
  await writeFile(join(featuresDir, 'billing.md'), feature.replace('청구서를 받아 검토한다.', '의도 수정'));
  const refreshed = await (await post(`${base}/api/refresh`)).json();
  assert.equal(refreshed.features[0].plan, '의도 수정');
  assert.equal(refreshed.features[0].checks[0].result, 'issue');
  assert.equal(refreshed.features[0].checks[0].note, '목록에 안 보임');
  assert.equal(prCalls(), 2);

  assert.equal((await post(`${base}/api/features/billing/complete`)).status, 200);
  const active = await (await fetch(`${base}/api/board`)).json();
  assert.equal(active.features.length, 0);
  assert.deepEqual(active.counts, { active: 0, done: 1 });
  const done = await (await fetch(`${base}/api/board?view=done`)).json();
  assert.equal(done.features[0].id, 'billing');
  assert.equal(done.features[0].steps[0].pr, null);
  assert.ok(done.features[0].completedAt);

  await post(`${base}/api/refresh`);
  assert.equal(prCalls(), 2, 'completed feature is not looked up on refresh');

  assert.equal((await post(`${base}/api/features/billing/reopen`)).status, 200);
  const back = await (await fetch(`${base}/api/board`)).json();
  assert.equal(back.features[0].steps[0].pr.status, 'open');
  assert.equal(prCalls(), 3, 'reopened feature reads its PRs');
});

test('rejects foreign origins and unknown features', async (t) => {
  const { base } = await start(t);
  assert.equal((await post(`${base}/api/features/billing/complete`, undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(`${base}/api/features/unknown/complete`)).status, 404);
});

test('token: .env first, then gh login, never fails startup', async () => {
  const { resolveToken } = await import('../server.mjs');
  const gh = async () => ({ stdout: 'gho_fromgh\n' });
  assert.deepEqual(await resolveToken({ GITHUB_TOKEN: 'from-env' }, gh), { token: 'from-env', source: '.env 토큰' });
  assert.deepEqual(await resolveToken({}, gh), { token: 'gho_fromgh', source: 'gh 로그인' });
  assert.deepEqual(await resolveToken({ GITHUB_TOKEN_FROM_GH: '0' }, gh), { token: '', source: '' });
  assert.deepEqual(await resolveToken({}, async () => { throw new Error('gh not installed'); }), { token: '', source: '' });
});
