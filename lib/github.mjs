const API = 'https://api.github.com';

export function prStatus(pull) {
  if (pull.merged_at) return 'merged';
  if (pull.state === 'closed') return 'closed';
  if (pull.draft) return 'draft';
  return 'open';
}

export class GithubError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
  }
}

function describe(error) {
  if (error.name === 'AbortError') return 'GitHub 응답 시간 초과';
  return error.message || 'GitHub 조회 실패';
}

// Read-only GitHub client. No caching by time: the owner refreshes manually.
export function createGithubClient({ token = '', fetchImpl = globalThis.fetch } = {}) {
  const fileCache = new Map(); // path -> { sha, text }

  async function request(route, { raw = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9_000);
    try {
      const response = await fetchImpl(`${API}${route}`, {
        signal: controller.signal,
        headers: {
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'jakupan-feature-board',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403
          ? `GitHub 접근 권한 또는 API 한도 확인 필요 (${response.status})`
          : response.status === 404 ? 'GitHub에서 찾을 수 없음 (404)' : `GitHub 조회 실패 (${response.status})`;
        throw new GithubError(message, response.status);
      }
      return raw ? response.text() : response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function repoPath(repo) {
    const [owner, name] = repo.split('/');
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  }

  async function resolveStep(step) {
    if (!step.repo || (!step.branch && !step.number)) return { status: 'planned', url: '', number: null, title: '' };
    const base = `${repoPath(step.repo)}/pulls`;
    try {
      let pull;
      if (step.number) {
        pull = await request(`${base}/${step.number}`);
      } else {
        const [owner] = step.repo.split('/');
        const query = new URLSearchParams({ state: 'all', head: `${owner}:${step.branch}`, per_page: '100' });
        const pulls = await request(`${base}?${query}`);
        if (!Array.isArray(pulls)) throw new GithubError('GitHub 응답 형식을 확인할 수 없습니다.');
        // Exact branch match only: never attach an unrelated PR by fuzzy title.
        pull = pulls
          .filter((item) => item.head?.ref === step.branch && item.base?.repo?.full_name?.toLowerCase() === step.repo.toLowerCase())
          .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
      }
      return pull
        ? { status: prStatus(pull), url: pull.html_url || '', number: pull.number, title: pull.title || '' }
        : { status: 'planned', url: '', number: null, title: '' };
    } catch (error) {
      return { status: 'unavailable', url: '', number: step.number || null, title: '', error: describe(error) };
    }
  }

  // Lists Markdown files in a repository folder and returns their text.
  // Unchanged files (same blob sha) are not downloaded again.
  async function readFolder(repo, dir, ref, accept = () => true) {
    const cleanDir = dir.replace(/^\/+|\/+$/g, '');
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const encodedDir = cleanDir.split('/').map(encodeURIComponent).join('/');
    let entries;
    try {
      entries = await request(`${repoPath(repo)}/contents/${encodedDir}${query}`);
    } catch (error) {
      if (error.status === 404) return { files: [], error: `${repo}의 ${cleanDir}/ 폴더가 아직 없습니다.` };
      return { files: [], error: describe(error) };
    }
    if (!Array.isArray(entries)) return { files: [], error: `${cleanDir}는 폴더가 아닙니다.` };
    const files = [];
    const errors = [];
    const targets = entries.filter((entry) => entry.type === 'file' && accept(entry.name));
    for (let i = 0; i < targets.length; i += 6) {
      await Promise.all(targets.slice(i, i + 6).map(async (entry) => {
        const cached = fileCache.get(entry.path);
        let text = cached?.sha === entry.sha ? cached.text : null;
        if (text == null) {
          try {
            text = await request(`${repoPath(repo)}/contents/${entry.path.split('/').map(encodeURIComponent).join('/')}${query}`, { raw: true });
            fileCache.set(entry.path, { sha: entry.sha, text });
          } catch (error) {
            errors.push(`${entry.name}: ${describe(error)}`);
            return;
          }
        }
        files.push({ name: entry.name, path: entry.path, text, url: entry.html_url || `https://github.com/${repo}/blob/${ref || 'main'}/${entry.path}` });
      }));
    }
    return { files, error: errors.join(' · ') };
  }

  return { resolveStep, readFolder };
}
