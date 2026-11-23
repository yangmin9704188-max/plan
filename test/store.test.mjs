import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, normalizeFeature } from '../lib/store.mjs';

const sample = {
  title: '청구서 접수', product: 'Office', summary: '업체 청구서를 받아 검토한다',
  specification: '# 최종 기획', developmentPlan: 'PR01부터 PR03까지',
  prSlots: [{ label: 'PR01 — 기본', repo: 'acme/office', branch: 'feat/billing-pr01' }],
  checks: [{ text: '청구서를 저장하고 다시 확인할 수 있는가?' }]
};

test('feature input: exact repo/branch and result constraints', () => {
  const normalized = normalizeFeature(sample);
  assert.equal(normalized.prSlots[0].branch, 'feat/billing-pr01');
  assert.equal(normalized.checks[0].result, 'pending');
  assert.throws(() => normalizeFeature({ ...sample, prSlots: [{ label: 'PR01', repo: 'invalid/repo/name', branch: 'main' }] }), /owner\/repo/);
  assert.throws(() => normalizeFeature({ ...sample, checks: [{ text: '확인', result: 'verified-by-agent' }] }), /확인 결과/);
  assert.throws(() => normalizeFeature({ ...sample, specificationUrl: 'javascript:alert(1)' }), /http\(s\)/);
});

test('create, persist, edit, owner check and delete without changing PR status', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jakupan-board-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'features.json');
  const store = new FileStore(path);
  const created = await store.create(sample);
  assert.equal((await store.list()).length, 1);
  const checkId = created.checks[0].id;

  await store.updateCheck(created.id, checkId, { result: 'issue', note: '금액 저장이 안 됨' });
  const reloaded = new FileStore(path);
  assert.equal((await reloaded.list())[0].checks[0].note, '금액 저장이 안 됨');
  const changed = await reloaded.update(created.id, {
    ...created,
    title: '청구서 접수 / 수정',
    checks: [{ id: checkId, text: '수정 후 다시 열어도 유지되는가?', result: 'pass', note: '조작 불가' }]
  });
  assert.equal(changed.checks[0].result, 'issue');
  assert.equal(changed.checks[0].note, '금액 저장이 안 됨');
  assert.equal(changed.title, '청구서 접수 / 수정');
  await reloaded.remove(created.id);
  assert.deepEqual(await reloaded.list(), []);
});

test('concurrent check updates never overwrite other features', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jakupan-board-race-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new FileStore(join(dir, 'features.json'));
  const features = await Promise.all(Array.from({ length: 8 }, (_, i) => store.create({ ...sample, title: `기능 ${i}` })));
  assert.equal((await store.list()).length, 8);
  await Promise.all(features.map((f) => store.updateCheck(f.id, f.checks[0].id, { result: 'pass', note: '확인' })));
  assert.equal((await store.list()).filter((f) => f.checks[0].result === 'pass').length, 8);
});