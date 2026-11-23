import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Owner-only local state: check results, notes and completion.
// GPT-written content lives in GitHub; this file never stores plan text.
export const RESULTS = new Set(['pending', 'pass', 'issue']);

export class InputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'InputError';
    this.statusCode = statusCode;
  }
}

function empty() {
  return { version: 2, features: {} };
}

export class StateStore {
  #writes = Promise.resolve();

  constructor(filePath) {
    this.filePath = filePath;
  }

  async #read() {
    try {
      const raw = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.features !== 'object') return empty();
      return raw;
    } catch (error) {
      if (error.code === 'ENOENT') return empty();
      throw error;
    }
  }

  async read() {
    await this.#writes;
    return this.#read();
  }

  async #change(mutate) {
    const job = this.#writes.then(async () => {
      const data = await this.#read();
      const value = mutate(data);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.filePath);
      return structuredClone(value);
    });
    this.#writes = job.then(() => undefined, () => undefined);
    return job;
  }

  #entry(data, featureId) {
    data.features[featureId] ??= { completedAt: null, checks: {} };
    data.features[featureId].checks ??= {};
    return data.features[featureId];
  }

  async setCheck(featureId, checkId, { result, note }) {
    if (!RESULTS.has(result)) throw new InputError('확인 결과는 미확인/통과/문제 중 하나여야 합니다.');
    if (note != null && typeof note !== 'string') throw new InputError('메모는 문자열이어야 합니다.');
    const cleanNote = (note ?? '').trim();
    if (cleanNote.length > 1000) throw new InputError('메모는 1000자 이하여야 합니다.');
    return this.#change((data) => {
      const entry = this.#entry(data, featureId);
      entry.checks[checkId] = { result, note: cleanNote, updatedAt: new Date().toISOString() };
      return entry.checks[checkId];
    });
  }

  async setCompleted(featureId, completed) {
    return this.#change((data) => {
      const entry = this.#entry(data, featureId);
      entry.completedAt = completed ? new Date().toISOString() : null;
      return entry;
    });
  }
}
