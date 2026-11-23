import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCardFile, parsePolicyFile } from '../lib/cards.mjs';
import { createMenuBoard } from '../lib/menu-board.mjs';
import { StateStore } from '../lib/state.mjs';

// Office 저장소 scripts/feature-cards.node-test.mjs와 같은 예시. 형식이 바뀌면 둘 다 고친다.
const menu = `---
메뉴: 정산센터 > 업체 청구
대상: 인력사무소
TODO:
- BIL-*
---

## BIL-04 다른 현장 추가
상태: 병합
위치: 생성 패널
정책:
- POL-VAT-MIXED
API:
- GET /api/settlement-center/billing-workspace?stage=preparation — 버튼 누를 때 1회
이력:
- 2026-11-20 추가 #200
- 2026-11-24 변경 #239 처음 만듦
확인:
- 같은 거래처 현장만 나온다

## BIL-08 명세서 엑셀
상태: 준비 중
위치: 명세 모달
`;
const policies = `## POL-VAT-MIXED 한 청구서에 부가세 처리를 섞지 않는다
규칙: 처리가 다르면 거절
근거: 사업 결정
`;

test('card parser matches the Office checker format', () => {
  const parsed = parseCardFile('m.md', menu);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.cards[0].apis[0].path, '/api/settlement-center/billing-workspace');
  assert.deepEqual(parsed.cards[0].history.map((h) => h.prs[0]), [200, 239]);
  assert.equal(parsePolicyFile('p.md', policies).policies[0].basis, '사업 결정');
});

test('menu board reads local cards, orders history newest first and stores checks under card ids', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cards-'));
  const cards = join(dir, 'cards');
  await mkdir(cards);
  await writeFile(join(cards, 'billing.md'), menu);
  await writeFile(join(cards, 'policies.md'), policies);
  await writeFile(join(cards, 'README.md'), '# 형식 설명');
  const state = new StateStore(join(dir, 'state.json'));
  const board = createMenuBoard({ github: null, state, source: { localDir: cards } });
  const view = await board.view();
  assert.equal(view.menus.length, 1);
  const card = view.menus[0].cards.find((c) => c.id === 'BIL-04');
  assert.equal(card.history[0].date, '2026-11-24');
  assert.equal(view.policies[0].id, 'POL-VAT-MIXED');
  await board.setCheck('BIL-04', card.checks[0].id, { result: 'pass' });
  const saved = await state.read();
  assert.equal(saved.features['card:BIL-04'].checks[card.checks[0].id].result, 'pass');
  assert.equal((await board.view()).menus[0].cards[0].checks[0].result, 'pass');
  await assert.rejects(board.setCheck('BIL-99', 'x', { result: 'pass' }), /기능 카드/);
});
