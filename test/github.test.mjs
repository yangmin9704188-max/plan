import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubClient, prStatus } from '../lib/github.mjs';

function fakePull(extra = {}) {
  return {
    number: 42, state: 'closed', merged_at: '2026-11-24T10:00:00Z',
    draft: false, title: 'Step 1: 수신 기반',
    head: { ref: 'feat/billing-1' },
    base: { repo: { full_name: 'acme/office' } },
    html_url: 'https://github.com/acme/office/pull/42', created_at: '2026-11-23T00:00:00Z',
    ...extra
  };
}

const ok = (value) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status: 200 });

test('PR status never confuses closed without merge and merged', () => {
  assert.equal(prStatus(fakePull()), 'merged');
  assert.equal(prStatus(fakePull({ merged_at: null })), 'closed');
  assert.equal(prStatus(fakePull({ merged_at: null, state: 'open', draft: true })), 'draft');
  assert.equal(prStatus(fakePull({ merged_at: null, state: 'open', draft: false })), 'open');
});

test('branch linking uses exact head branch match with the token', async () => {
  let requestUrl = '';
  const client = createGithubClient({ token: 'test-token', fetchImpl: async (url, options) => {
    requestUrl = url;
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return ok([fakePull({ number: 41, head: { ref: 'feat/billing-2' } }), fakePull()]);
  } });
  const got = await client.resolveStep({ repo: 'acme/office', branch: 'feat/billing-1' });
  assert.equal(got.status, 'merged');
  assert.equal(got.number, 42);
  assert.match(requestUrl, /head=acme%3Afeat%2Fbilling-1/);
});

test('GitHub failure is unavailable; unlinked step is planned', async () => {
  const client = createGithubClient({ fetchImpl: async () => new Response('{}', { status: 403 }) });
  const got = await client.resolveStep({ repo: 'acme/private', branch: 'feat/a' });
  assert.equal(got.status, 'unavailable');
  assert.match(got.error, /403/);
  assert.equal((await client.resolveStep({ repo: 'acme/office', branch: '', number: null })).status, 'planned');
});

test('folder read skips unchanged files by sha and reports a missing folder', async () => {
  const calls = [];
  let sha = 'a1';
  const client = createGithubClient({ fetchImpl: async (url, options) => {
    calls.push(url);
    if (url.includes('/contents/features?')) {
      return ok([
        { type: 'file', name: 'billing.md', path: 'features/billing.md', sha, html_url: 'https://github.com/acme/plan/blob/main/features/billing.md' },
        { type: 'file', name: '_TEMPLATE.md', path: 'features/_TEMPLATE.md', sha: 't' }
      ]);
    }
    assert.equal(options.headers.Accept, 'application/vnd.github.raw+json');
    return ok(`## 기획\n버전 ${sha}`);
  } });
  const accept = (name) => !name.startsWith('_');
  const first = await client.readFolder('acme/plan', 'features', 'main', accept);
  assert.equal(first.files.length, 1);
  assert.match(first.files[0].text, /a1/);
  assert.equal(calls.length, 2);
  await client.readFolder('acme/plan', 'features', 'main', accept);
  assert.equal(calls.length, 3, 'unchanged file is not downloaded again');
  sha = 'b2';
  const changed = await client.readFolder('acme/plan', 'features', 'main', accept);
  assert.match(changed.files[0].text, /b2/);

  const missing = createGithubClient({ fetchImpl: async () => new Response('{}', { status: 404 }) });
  const result = await missing.readFolder('acme/plan', 'features', 'main');
  assert.deepEqual(result.files, []);
  assert.match(result.error, /폴더가 아직 없습니다/);
});
