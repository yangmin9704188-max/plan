import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCardFile, parsePolicyFile } from './cards.mjs';
import { checkId } from './features.mjs';
import { InputError } from './state.mjs';

// 메뉴별 기능 카드 보기. Office 저장소의 docs/feature-cards/*.md를 읽기만 한다.
// 확인 결과는 기획 기능과 같은 state.json에 `card:<ID>` 키로 저장한다.
const STATE_PREFIX = 'card:';
const isCardFile = (name) => /\.md$/i.test(name) && !/^(readme|policies)\.md$/i.test(name) && !name.startsWith('_');

async function readLocal(dir) {
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort();
    return { files: await Promise.all(names.map(async (name) => ({ name, text: await readFile(join(dir, name), 'utf8'), url: '' }))), error: '' };
  } catch (error) {
    if (error.code === 'ENOENT') return { files: [], error: `${dir} 폴더가 없습니다.` };
    throw error;
  }
}

function withCheckIds(texts) {
  const seen = new Map();
  return texts.map((text) => {
    const base = checkId(text);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return { id: count ? `${base}-${count}` : base, text };
  });
}

export function createMenuBoard({ github, state, source }) {
  let snapshot = null;
  let syncing = null;

  async function sync() {
    const { files, error } = source.localDir
      ? await readLocal(source.localDir)
      : await github.readFolder(source.repo, source.dir, source.ref, (name) => name.endsWith('.md'));
    const problems = [];
    const policyFile = files.find((f) => f.name.toLowerCase() === 'policies.md');
    const policies = policyFile ? parsePolicyFile(policyFile.name, policyFile.text) : { policies: [], problems: [] };
    problems.push(...policies.problems);
    const menus = files.filter((f) => isCardFile(f.name)).map((file) => {
      const parsed = parseCardFile(file.name, file.text);
      problems.push(...parsed.problems);
      return {
        file: file.name, url: file.url, menu: parsed.menu,
        cards: parsed.cards.map((card) => ({ ...card, checks: withCheckIds(card.checks) })),
      };
    }).sort((a, b) => a.menu.localeCompare(b.menu, 'ko'));
    snapshot = {
      syncedAt: new Date().toISOString(),
      sourceError: error || '',
      menus,
      policies: policies.policies,
      problems: problems.filter((p) => p.level === 'error').map((p) => `${p.where}:${p.line} ${p.message}`),
    };
    return snapshot;
  }

  async function refresh() {
    syncing ??= sync().finally(() => { syncing = null; });
    return syncing;
  }

  async function view() {
    const snap = snapshot ?? await refresh();
    const owner = await state.read();
    const menus = snap.menus.map((menu) => ({
      ...menu,
      cards: menu.cards.map((card) => {
        const results = owner.features[STATE_PREFIX + card.id]?.checks || {};
        return {
          id: card.id, title: card.title, audience: card.audience, status: card.status, location: card.location,
          policies: card.policies, apis: card.apis.map(({ method, path, note, text }) => ({ method, path, note, text })),
          data: card.data, note: card.note,
          history: [...card.history].sort((a, b) => b.date.localeCompare(a.date)).map(({ date, kind, detail, prs }) => ({ date, kind, detail, prs })),
          performance: card.performance.map((p) => p.text),
          checks: card.checks.map((check) => ({ ...check, result: results[check.id]?.result || 'pending', note: results[check.id]?.note || '' })),
        };
      }),
    }));
    return {
      syncedAt: snap.syncedAt,
      source: source.localDir
        ? { kind: 'local', label: source.localDir }
        : { kind: 'github', label: `${source.repo}/${source.dir}`, url: `https://github.com/${source.repo}/tree/${source.ref}/${source.dir}` },
      sourceError: snap.sourceError,
      problems: snap.problems,
      policies: snap.policies.map(({ id, title, rule, basis }) => ({ id, title, rule, basis })),
      menus,
    };
  }

  async function setCheck(cardId, checkIdValue, body) {
    const snap = snapshot ?? await refresh();
    const card = snap.menus.flatMap((m) => m.cards).find((c) => c.id === cardId);
    if (!card) throw new InputError('해당 기능 카드를 찾지 못했습니다. 새로고침 후 다시 시도하세요.', 404);
    if (!card.checks.some((c) => c.id === checkIdValue)) throw new InputError('확인 항목을 찾지 못했습니다.', 404);
    return state.setCheck(STATE_PREFIX + cardId, checkIdValue, body ?? {});
  }

  return { refresh, view, setCheck };
}
