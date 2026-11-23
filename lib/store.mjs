import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const PRODUCTS = new Set(['Office', 'Worker', 'Works', 'Network', 'Market', '기타']);
const RESULTS = new Set(['pending', 'pass', 'issue']);

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
    this.statusCode = 400;
  }
}

export class NotFoundError extends Error {
  constructor(message = '해당 기능을 찾지 못했습니다.') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

function str(value, label, maxLength, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new InputError(`${label}: 문자열이어야 합니다.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new InputError(`${label}: 필수 입력입니다.`);
  if (trimmed.length > maxLength) throw new InputError(`${label}: ${maxLength}자 이하여야 합니다.`);
  return trimmed;
}

function url(value, label) {
  const clean = str(value, label, 2000);
  if (!clean) return '';
  try {
    const parsed = new URL(clean);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    return parsed.toString();
  } catch {
    throw new InputError(`${label}: 유효한 http(s) 주소여야 합니다.`);
  }
}

function normalizePrSlot(item) {
  if (!item || typeof item !== 'object') throw new InputError('PR 계획의 형식이 올바르지 않습니다.');
  const repo = str(item.repo ?? '', '저장소', 160);
  const branch = str(item.branch ?? '', '브랜치', 200);
  const label = str(item.label, 'PR 계획 제목', 140, true);
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new InputError('저장소는 owner/repo 형식이어야 합니다.');
  if (branch && (!/^[\w./-]+$/.test(branch) || branch.includes('..') || branch.endsWith('/'))) {
    throw new InputError('브랜치 이름이 올바르지 않습니다.');
  }
  const number = item.number === '' || item.number == null ? null : Number(item.number);
  if (number !== null && (!Number.isSafeInteger(number) || number <= 0)) {
    throw new InputError('PR 번호는 양의 정수여야 합니다.');
  }
  if ((branch || number !== null) && !repo) throw new InputError('브랜치나 PR 번호가 있으면 저장소를 입력해야 합니다.');
  return { id: typeof item.id === 'string' && item.id.length < 80 ? item.id : randomUUID(), label, repo, branch, number };
}

function normalizeCheck(item) {
  if (!item || typeof item !== 'object') throw new InputError('확인 항목의 형식이 올바르지 않습니다.');
  const result = item.result ?? 'pending';
  if (!RESULTS.has(result)) throw new InputError('확인 결과는 미확인/통과/문제 중 하나여야 합니다.');
  return {
    id: typeof item.id === 'string' && item.id.length < 80 ? item.id : randomUUID(),
    text: str(item.text, '확인할 내용', 280, true),
    result,
    note: str(item.note ?? '', '확인 메모', 1000)
  };
}

export function normalizeFeature(input, previous = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InputError('기능 데이터의 형식이 올바르지 않습니다.');
  }
  const product = str(input.product ?? 'Office', '제품', 40);
  if (!PRODUCTS.has(product)) throw new InputError('제품 구분이 올바르지 않습니다.');
  const prSlots = input.prSlots ?? [];
  const checks = input.checks ?? [];
  if (!Array.isArray(prSlots) || prSlots.length > 40) throw new InputError('PR 계획은 40개 이하여야 합니다.');
  if (!Array.isArray(checks) || checks.length > 100) throw new InputError('확인 항목은 100개 이하여야 합니다.');
  const normalizedSlots = prSlots.map(normalizePrSlot);
  const normalizedChecks = checks.map(normalizeCheck);
  if (new Set(normalizedSlots.map((x) => x.id)).size !== normalizedSlots.length) throw new InputError('중복된 PR 계획 ID입니다.');
  if (new Set(normalizedChecks.map((x) => x.id)).size !== normalizedChecks.length) throw new InputError('중복된 확인 항목 ID입니다.');
  const now = new Date().toISOString();
  return {
    id: previous?.id ?? randomUUID(),
    title: str(input.title, '기능명', 140, true),
    product,
    summary: str(input.summary ?? '', '요약', 1200),
    specification: str(input.specification ?? '', '최종 기획서', 70000),
    developmentPlan: str(input.developmentPlan ?? '', '개발계획서', 70000),
    specificationUrl: url(input.specificationUrl ?? '', '기획서 링크'),
    developmentPlanUrl: url(input.developmentPlanUrl ?? '', '개발계획서 링크'),
    prSlots: normalizedSlots,
    checks: normalizedChecks,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  };
}

export class FileStore {
  #writes = Promise.resolve();

  constructor(filePath) {
    this.filePath = filePath;
  }

  async #read() {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!Array.isArray(raw)) throw new Error('저장 데이터 형식이 올바르지 않습니다.');
      return raw;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async list() {
    await this.#writes;
    return structuredClone(await this.#read());
  }

  async #writeChange(change) {
    const job = this.#writes.then(async () => {
      const items = await this.#read();
      const value = change(items);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.filePath);
      return structuredClone(value);
    });
    this.#writes = job.then(() => undefined, () => undefined);
    return job;
  }

  async create(input) {
    const feature = normalizeFeature(input);
    return this.#writeChange((items) => {
      items.unshift(feature);
      return feature;
    });
  }

  async update(id, input) {
    return this.#writeChange((items) => {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) throw new NotFoundError();
      const previous = items[index];
      const incoming = normalizeFeature(input, previous);
      // The editor can change check wording, but only the checklist endpoint
      // is allowed to change an existing verification result or note.
      const previousChecks = new Map(previous.checks.map((item) => [item.id, item]));
      incoming.checks = incoming.checks.map((item) => {
        const existing = previousChecks.get(item.id);
        return existing ? { ...item, result: existing.result, note: existing.note } : { ...item, result: 'pending', note: '' };
      });
      items[index] = incoming;
      return incoming;
    });
  }

  async updateCheck(featureId, checkId, { result, note }) {
    if (!RESULTS.has(result)) throw new InputError('확인 결과가 올바르지 않습니다.');
    const safeNote = str(note ?? '', '메모', 1000);
    return this.#writeChange((items) => {
      const feature = items.find((item) => item.id === featureId);
      if (!feature) throw new NotFoundError();
      const check = feature.checks.find((item) => item.id === checkId);
      if (!check) throw new NotFoundError('확인 항목을 찾지 못했습니다.');
      check.result = result;
      check.note = safeNote;
      feature.updatedAt = new Date().toISOString();
      return feature;
    });
  }

  async remove(id) {
    return this.#writeChange((items) => {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) throw new NotFoundError();
      return items.splice(index, 1)[0];
    });
  }
}