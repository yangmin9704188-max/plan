import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { featureIdFromPath, isFeatureFile, parseFeatureDoc } from './features.mjs';
import { InputError } from './state.mjs';

async function readLocalFolder(dir) {
  try {
    const names = (await readdir(dir)).filter(isFeatureFile).sort();
    const files = await Promise.all(names.map(async (name) => ({ name, path: name, text: await readFile(join(dir, name), 'utf8'), url: '' })));
    return { files, error: '' };
  } catch (error) {
    if (error.code === 'ENOENT') return { files: [], error: `${dir} 폴더가 없습니다.` };
    throw error;
  }
}

async function inChunks(items, size, task) {
  const results = [];
  for (let i = 0; i < items.length; i += size) results.push(...await Promise.all(items.slice(i, i + size).map(task)));
  return results;
}

// Holds the last manual sync. Nothing polls in the background.
export function createBoard({ github, state, source }) {
  let snapshot = null;
  let syncing = null;

  function sourceLabel() {
    return source.localDir ? { kind: 'local', label: source.localDir } : { kind: 'github', label: `${source.repo}/${source.dir}`, url: `https://github.com/${source.repo}/tree/${source.ref}/${source.dir}` };
  }

  async function resolveSteps(doc) {
    return inChunks(doc.steps, 6, (step) => github.resolveStep(step));
  }

  async function sync() {
    const { files, error } = source.localDir
      ? await readLocalFolder(source.localDir)
      : await github.readFolder(source.repo, source.dir, source.ref, isFeatureFile);
    const owner = await state.read();
    const docs = new Map();
    for (const file of files) {
      const doc = parseFeatureDoc(featureIdFromPath(file.name), file.text);
      docs.set(doc.id, { doc, url: file.url });
    }
    const prs = new Map();
    // Completed features are not looked up again, so the done list stays cheap.
    const active = [...docs.values()].filter(({ doc }) => !owner.features[doc.id]?.completedAt);
    await inChunks(active, 3, async ({ doc }) => prs.set(doc.id, await resolveSteps(doc)));
    snapshot = { syncedAt: new Date().toISOString(), sourceError: error || '', docs, prs };
    return snapshot;
  }

  async function refresh() {
    // Concurrent refresh clicks share one GitHub sync.
    syncing ??= sync().finally(() => { syncing = null; });
    return syncing;
  }

  async function current() {
    return snapshot ?? refresh();
  }

  function present({ doc, url }, owner, prs, withPrs) {
    const entry = owner.features[doc.id] || {};
    const results = entry.checks || {};
    const checks = doc.checks.map((check) => ({
      ...check,
      result: results[check.id]?.result || 'pending',
      note: results[check.id]?.note || ''
    }));
    const steps = doc.steps.map((step, i) => ({ ...step, pr: withPrs ? (prs?.[i] || { status: 'planned' }) : null }));
    return {
      id: doc.id, title: doc.title, products: doc.products, plan: doc.plan, url,
      steps, checks, warnings: doc.warnings, completedAt: entry.completedAt || null,
      counts: {
        merged: withPrs ? steps.filter((s) => s.pr?.status === 'merged').length : null,
        steps: steps.length,
        pass: checks.filter((c) => c.result === 'pass').length,
        issue: checks.filter((c) => c.result === 'issue').length,
        checks: checks.length
      }
    };
  }

  async function view(kind = 'active') {
    const snap = await current();
    const owner = await state.read();
    const all = [...snap.docs.values()];
    const isDone = (item) => Boolean(owner.features[item.doc.id]?.completedAt);
    const selected = all.filter((item) => (kind === 'done' ? isDone(item) : !isDone(item)));
    const features = selected.map((item) => present(item, owner, snap.prs.get(item.doc.id), kind !== 'done'));
    features.sort(kind === 'done'
      ? (a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')
      : (a, b) => a.title.localeCompare(b.title, 'ko'));
    return {
      view: kind,
      syncedAt: snap.syncedAt,
      source: sourceLabel(),
      sourceError: snap.sourceError,
      counts: { active: all.filter((i) => !isDone(i)).length, done: all.filter(isDone).length },
      features
    };
  }

  async function find(featureId) {
    const snap = await current();
    const item = snap.docs.get(featureId);
    if (!item) throw new InputError('해당 기능을 찾지 못했습니다. 새로고침 후 다시 시도하세요.', 404);
    return { snap, item };
  }

  async function setCheck(featureId, checkId, body) {
    const { item } = await find(featureId);
    if (!item.doc.checks.some((check) => check.id === checkId)) throw new InputError('확인 항목을 찾지 못했습니다.', 404);
    return state.setCheck(featureId, checkId, body ?? {});
  }

  async function setCompleted(featureId, completed) {
    const { snap, item } = await find(featureId);
    const result = await state.setCompleted(featureId, completed);
    // A reopened feature was skipped during the last sync; read its PRs now.
    if (!completed && !snap.prs.has(featureId)) snap.prs.set(featureId, await resolveSteps(item.doc));
    return result;
  }

  return { refresh, view, setCheck, setCompleted };
}
