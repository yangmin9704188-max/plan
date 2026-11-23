import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../server.mjs';

test('HTTP API: create, list, get GitHub progress, check owner result and origin security', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jakupan-board-http-'));
  const server = createAppServer({
    dataPath: join(dir, 'features.json'),
    token: 'testing',
    fetchImpl: async () => new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await fetch(base);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /개발 진행표/);

  const feature = {
    title: '이메일 청구 수신', product: 'Office', summary: 'PR 자동 조회 테스트',
    prSlots: [{ label: 'PR01', repo: 'acme/office', branch: 'feat/billing' }],
    checks: [{ text: '청구서가 나타나는가?' }]
  };
  const created = await fetch(`${base}/api/features`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feature)
  });
  assert.equal(created.status, 201);
  const { feature: saved } = await created.json();
  assert.equal((await (await fetch(`${base}/api/features`)).json()).features[0].id, saved.id);
  const status = await (await fetch(`${base}/api/progress`)).json();
  assert.equal(status.progress[0].slots[0].status, 'planned');

  const changed = await fetch(`${base}/api/features/${saved.id}/checks/${saved.checks[0].id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result: 'pass', note: '정상' })
  });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).feature.checks[0].result, 'pass');

  const rejected = await fetch(`${base}/api/features`, {
    method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify(feature)
  });
  assert.equal(rejected.status, 403);
  assert.equal((await (await fetch(`${base}/api/features`)).json()).features.length, 1);
});