import test from 'node:test';
import assert from 'node:assert/strict';
import { checkId, isFeatureFile, parseFeatureDoc } from '../lib/features.mjs';

const doc = `---
title: 정산센터 개편
products: Office, Worker, Office
repo: acme/office
---

## 기획

왜 만드는지 자유롭게.

### 세부
- 목록도 기획 본문에 그대로 남는다

## 개발 계획

- Step 1 — 집계 쿼리 | branch: feat/settle-1
- 부가세 | feat/settle-2 | repo: acme/worker
- 엑셀 | pr: 168
- 미정 단계
- 잘못된 단계 | repo: not a repo

## 확인 항목

- [ ] 정산 화면 → 3월 선택 → 합계 일치
- 정산 화면 → 3월 선택 → 합계 일치
`;

test('parses front matter, free-text plan, steps and checks', () => {
  const parsed = parseFeatureDoc('settlement', doc);
  assert.equal(parsed.title, '정산센터 개편');
  assert.deepEqual(parsed.products, ['Office', 'Worker']);
  assert.match(parsed.plan, /왜 만드는지/);
  assert.match(parsed.plan, /### 세부/);
  assert.match(parsed.plan, /목록도 기획 본문에/);

  const [s1, s2, s3, s4, s5] = parsed.steps;
  assert.deepEqual(s1, { index: 1, title: '집계 쿼리', repo: 'acme/office', branch: 'feat/settle-1', number: null });
  assert.equal(s2.branch, 'feat/settle-2');
  assert.equal(s2.repo, 'acme/worker');
  assert.equal(s3.number, 168);
  assert.equal(s4.branch, '');
  assert.equal(s5.repo, 'acme/office');
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /owner\/repo/);

  assert.equal(parsed.checks.length, 2);
  assert.equal(parsed.checks[0].id, checkId('정산 화면 → 3월 선택 → 합계 일치'));
  assert.notEqual(parsed.checks[0].id, parsed.checks[1].id);
});

test('check ids are stable across re-parsing, so local results survive refresh', () => {
  assert.deepEqual(parseFeatureDoc('a', doc).checks, parseFeatureDoc('a', doc.replace('왜 만드는지', '의도가 바뀜')).checks);
});

test('title falls back to H1 then file id; template and README are skipped', () => {
  assert.equal(parseFeatureDoc('x', '# 제목만\n\n## 기획\n내용').title, '제목만');
  assert.equal(parseFeatureDoc('file-id', '## 기획\n내용').title, 'file-id');
  assert.equal(isFeatureFile('settlement.md'), true);
  assert.equal(isFeatureFile('_TEMPLATE.md'), false);
  assert.equal(isFeatureFile('README.md'), false);
  assert.equal(isFeatureFile('notes.txt'), false);
});
