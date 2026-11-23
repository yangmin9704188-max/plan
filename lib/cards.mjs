// Office 저장소 scripts/feature-cards-lib.mjs의 복사본. 형식: Office docs/feature-cards/README.md
// 형식을 바꾸면 두 저장소를 같이 고친다 (test/cards.test.mjs가 같은 예시를 검사).
// 외부 패키지 없이 Node 20+에서 동작한다.

export const AUDIENCES = ['인력사무소', '시공회사', '작업자', '외부', '공통'];
export const STATUSES = ['준비 중', '개발 중', '병합', '배포됨'];
export const HISTORY_KINDS = ['추가', '변경', '수정', '제거', '배포'];
export const CARD_KEYS = ['대상', '상태', '위치', '정책', 'API', '데이터', '이력', '성능', '확인', '메모'];
export const LIST_KEYS = new Set(['정책', 'API', '데이터', '이력', '성능', '확인', '소스', 'API 범위', 'TODO', '코드', '문서', '쓰는 기능']);
export const POLICY_KEYS = ['규칙', '근거', '코드', '문서', '메모'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function splitFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { front: '', body: normalized, bodyStart: 1 };
  return { front: match[1], body: normalized.slice(match[0].length), bodyStart: match[0].split('\n').length };
}

/** `키: 값` 줄과 `키:` 다음의 `- 항목` 목록을 읽는다. 들여쓰기·중첩은 쓰지 않는다. */
function readFields(lines, firstLine, problems, where) {
  const fields = {};
  let listKey = null;
  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    const lineNo = firstLine + index;
    if (!line.trim() || line.trim().startsWith('<!--')) return;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item) {
      if (!listKey) { problems.push({ level: 'error', where, line: lineNo, message: `목록 앞에 '키:' 줄이 없습니다: ${line.trim()}` }); return; }
      fields[listKey].push({ text: item[1].trim(), line: lineNo });
      return;
    }
    const pair = line.match(/^([^:：]+?)\s*[:：]\s*(.*)$/);
    if (!pair) { problems.push({ level: 'error', where, line: lineNo, message: `알 수 없는 줄: ${line.trim()}` }); return; }
    const key = pair[1].trim();
    const value = pair[2].trim();
    if (LIST_KEYS.has(key)) {
      listKey = key;
      fields[key] = fields[key] ?? [];
      if (value && value !== '없음') fields[key].push({ text: value, line: lineNo });
    } else {
      listKey = null;
      fields[key] = { text: value, line: lineNo };
    }
  });
  return fields;
}

function sections(body, bodyStart) {
  const result = [];
  let current = null;
  body.split('\n').forEach((line, index) => {
    const heading = line.match(/^##\s+(\S+)\s+(.+)$/);
    if (heading) {
      current = { id: heading[1].trim(), title: heading[2].trim(), line: bodyStart + index, lines: [] };
      result.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  });
  return result;
}

export function parseCardFile(path, text) {
  const problems = [];
  const { front, body, bodyStart } = splitFrontmatter(text);
  const meta = readFields(front.split('\n'), 2, problems, path);
  if (!meta['메뉴']?.text) problems.push({ level: 'error', where: path, line: 1, message: "머리말에 '메뉴:'가 없습니다." });
  const cards = sections(body, bodyStart).map((section) => {
    const fields = readFields(section.lines, section.line + 1, problems, path);
    const card = {
      file: path, line: section.line, id: section.id, title: section.title,
      menu: meta['메뉴']?.text ?? '',
      audience: (fields['대상']?.text ?? meta['대상']?.text ?? '').split(',').map((v) => v.trim()).filter(Boolean),
      status: fields['상태']?.text ?? '',
      location: fields['위치']?.text ?? '',
      policies: (fields['정책'] ?? []).map((v) => v.text.split(/\s+/)[0]),
      apis: (fields['API'] ?? []).map(parseApi),
      data: (fields['데이터'] ?? []).map((v) => v.text),
      history: (fields['이력'] ?? []).map(parseHistory),
      performance: (fields['성능'] ?? []).map((v) => ({ text: v.text, line: v.line, date: v.text.split(/\s+/)[0] })),
      checks: (fields['확인'] ?? []).map((v) => v.text),
      note: fields['메모']?.text ?? '',
      unknownKeys: Object.keys(fields).filter((k) => !CARD_KEYS.includes(k)),
    };
    validateCard(card, problems);
    return card;
  });
  return {
    file: path,
    menu: meta['메뉴']?.text ?? '',
    sources: (meta['소스'] ?? []).map((v) => v.text),
    apiScopes: (meta['API 범위'] ?? []).map((v) => v.text),
    todoIds: (meta['TODO'] ?? []).map((v) => v.text.split(/\s+/)[0]),
    cards,
    problems,
  };
}

export function parsePolicyFile(path, text) {
  const problems = [];
  const { body, bodyStart } = splitFrontmatter(text);
  const policies = sections(body, bodyStart).map((section) => {
    const fields = readFields(section.lines, section.line + 1, problems, path);
    const policy = {
      file: path, line: section.line, id: section.id, title: section.title,
      rule: fields['규칙']?.text ?? '', basis: fields['근거']?.text ?? '',
      code: (fields['코드'] ?? []).map((v) => v.text), docs: (fields['문서'] ?? []).map((v) => v.text),
      note: fields['메모']?.text ?? '',
    };
    if (!/^POL-[A-Z0-9-]+$/.test(policy.id)) problems.push({ level: 'error', where: path, line: policy.line, message: `정책 ID는 POL-로 시작하는 대문자여야 합니다: ${policy.id}` });
    if (!policy.rule) problems.push({ level: 'error', where: path, line: policy.line, message: `${policy.id}: '규칙:'이 없습니다.` });
    if (!policy.basis) problems.push({ level: 'error', where: path, line: policy.line, message: `${policy.id}: '근거:'가 없습니다. (법 / 사업 결정 / 기술 제약 중 무엇인지)` });
    for (const key of Object.keys(fields)) if (!POLICY_KEYS.includes(key)) problems.push({ level: 'error', where: path, line: policy.line, message: `${policy.id}: 알 수 없는 항목 '${key}'` });
    return policy;
  });
  return { file: path, policies, problems };
}

function parseApi(value) {
  const match = value.text.match(/^([A-Z]+)\s+(\S+)(?:\s+(.*))?$/);
  if (!match || !METHODS.includes(match[1])) return { text: value.text, line: value.line, method: null, path: null, note: '' };
  return { text: value.text, line: value.line, method: match[1], path: match[2].split('?')[0], note: (match[3] ?? '').replace(/^[—-]\s*/, '') };
}

function parseHistory(value) {
  const match = value.text.match(/^(\S+)\s+(\S+)\s*(.*)$/);
  const prs = [...value.text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  return { text: value.text, line: value.line, date: match?.[1] ?? '', kind: match?.[2] ?? '', detail: match?.[3] ?? '', prs };
}

function validateCard(card, problems) {
  const at = (message, line = card.line) => problems.push({ level: 'error', where: card.file, line, message: `${card.id}: ${message}` });
  if (!/^[A-Z]{2,6}-\d{2,3}[A-Z]?$/.test(card.id)) at(`기능 ID 형식은 BIL-04 같은 '영문-숫자'입니다.`);
  if (!card.audience.length) at("'대상:'이 없습니다.");
  for (const a of card.audience) if (!AUDIENCES.includes(a)) at(`대상 '${a}'은 ${AUDIENCES.join('/')} 중 하나여야 합니다.`);
  if (!STATUSES.includes(card.status)) at(`상태 '${card.status}'는 ${STATUSES.join('/')} 중 하나여야 합니다.`);
  if (!card.location) at("'위치:'가 없습니다.");
  for (const key of card.unknownKeys) at(`알 수 없는 항목 '${key}' (쓸 수 있는 항목: ${CARD_KEYS.join(', ')})`);
  for (const api of card.apis) if (!api.method) at(`API는 'GET /api/...' 형식이어야 합니다: ${api.text}`, api.line);
  for (const h of card.history) {
    if (!DATE.test(h.date)) at(`이력 날짜는 YYYY-MM-DD입니다: ${h.text}`, h.line);
    if (!HISTORY_KINDS.includes(h.kind)) at(`이력 종류는 ${HISTORY_KINDS.join('/')} 중 하나입니다: ${h.text}`, h.line);
  }
  for (const p of card.performance) if (!DATE.test(p.date)) at(`성능 기록은 날짜로 시작합니다: ${p.text}`, p.line);
  if (card.status !== '준비 중' && !card.history.length) at("만들어진 기능은 '이력:'이 최소 한 줄 필요합니다.");
  if (card.status !== '준비 중' && !card.checks.length) at("만들어진 기능은 '확인:' 항목이 필요합니다.");
}

/** {id}·{fileId} 같은 경로 변수를 같은 것으로 본다. */
export function normalizeApiPath(path) {
  return path.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '') || '/';
}

/** 패턴 끝의 `*`는 접두어, 중간의 `**`/`*`는 경로 와일드카드. */
export function globToRegExp(glob) {
  const pattern = glob.split(/(\*\*\/|\*\*|\*)/).map((part) => {
    if (part === '**/') return '(?:.*/)?';
    if (part === '**') return '.*';
    if (part === '*') return '[^/]*';
    return part.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  }).join('');
  return new RegExp('^' + pattern + '$');
}

/** `BIL-*`처럼 끝이 *이면 접두어, 아니면 정확히 같은 ID. */
export function matchesIdPattern(id, pattern) {
  return pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern;
}
