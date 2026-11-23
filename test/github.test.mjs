import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubClient, prStatus } from '../lib/github.mjs';

function fakePull(extra = {}) {
  return {
    number: 42, state: 'closed', merged_at: '2026-11-24T10:00:00Z',
    draft: false, title: 'PR01: 수신 기반',
    head: { ref: 'feat/billing-pr01' },
    base: { repo: { full_name: 'acme/office' } },
    html_url: 'https://github.com/acme/office/pull/42', created_at: '2026-11-23T00:00:00Z',
    ...extra
  };
}

test('PR status never confuses closed without merge and merged', () => {
  assert.equal(prStatus(fakePull()), 'merged');
  assert.equal(prStatus(fakePull({ merged_at: null })), 'closed');
  assert.equal(prStatus(fakePull({ merged_at: null, state: 'open', draft: true })), 'draft');
  assert.equal(prStatus(fakePull({ merged_at: null, state: 'open', draft: false })), 'open');
});

test('branch linking uses exact match, cached read-only GitHub calls', async () => {
  let calls = 0;
  let requestUrl = '';
  const client = createGithubClient({ token: 'test-token', fetchImpl: async (url, options) => {
    calls++;
    requestUrl = url;
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return new Response(JSON.stringify([
      fakePull({ number: 41, head: { ref: 'feat/billing-pr02' } }),
      fakePull()
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const slot = { repo: 'acme/office', branch: 'feat/billing-pr01' };
  const a = await client.resolveSlot(slot);
  const b = await client.resolveSlot(slot);
  assert.equal(a.status, 'merged');
  assert.equal(a.number, 42);
  assert.equal(b.number, 42);
  assert.equal(calls, 1);
  assert.match(requestUrl, /head=acme%3Afeat%2Fbilling-pr01/);
  assert.equal((await client.resolveSlot(slot, { refresh: true })).number, 42);
  assert.equal(calls, 2);
});

test('GitHub failure stays unavailable; never reports planned or merged', async () => {
  const client = createGithubClient({ fetchImpl: async () => new Response('{}', { status: 403 }) });
  const got = await client.resolveSlot({ repo: 'acme/private', branch: 'feat/a' });
  assert.equal(got.status, 'unavailable');
  assert.match(got.error, /403/);
  assert.equal((await client.resolveSlot({ label: 'PR02', repo: '', branch: '' })).status, 'planned');
});