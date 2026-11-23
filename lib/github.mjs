const API = 'https://api.github.com';

export function prStatus(pull) {
  if (pull.merged_at) return 'merged';
  if (pull.state === 'closed') return 'closed';
  if (pull.draft) return 'draft';
  return 'open';
}

export function createGithubClient({ token = '', fetchImpl = globalThis.fetch, ttlMs = 120_000 } = {}) {
  const cache = new Map();

  async function request(route) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9_000);
    try {
      const response = await fetchImpl(`${API}${route}`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'jakupan-feature-board',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403
          ? `GitHub 접근 권한 또는 API 한도 확인 필요 (${response.status})`
          : `GitHub 조회 실패 (${response.status})`;
        throw new Error(message);
      }
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveSlot(slot, { refresh = false } = {}) {
    if (!slot.repo || (!slot.branch && !slot.number)) {
      return { status: 'planned', title: '', url: '', number: null };
    }
    const key = `${slot.repo}|${slot.number || ''}|${slot.branch || ''}`;
    const cached = cache.get(key);
    if (!refresh && cached && Date.now() - cached.time < ttlMs) return cached.value;

    const [owner, repo] = slot.repo.split('/');
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;
    try {
      let pull;
      if (slot.number) {
        pull = await request(`${base}/${slot.number}`);
      } else {
        const query = new URLSearchParams({ state: 'all', head: `${owner}:${slot.branch}`, per_page: '100' });
        const pulls = await request(`${base}?${query}`);
        if (!Array.isArray(pulls)) throw new Error('GitHub 응답 형식을 확인할 수 없습니다.');
        // The exact branch match is essential: never attach an unrelated PR by fuzzy title.
        pull = pulls
          .filter((item) => item.head?.ref === slot.branch && item.base?.repo?.full_name?.toLowerCase() === slot.repo.toLowerCase())
          .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
      }
      const value = pull ? {
        status: prStatus(pull),
        title: pull.title || '',
        url: pull.html_url || '',
        number: pull.number,
        updatedAt: pull.updated_at || null
      } : { status: 'planned', title: '', url: '', number: null };
      cache.set(key, { time: Date.now(), value });
      return value;
    } catch (error) {
      const value = {
        status: 'unavailable',
        title: '',
        url: '',
        number: slot.number || null,
        error: error.name === 'AbortError' ? 'GitHub 응답 시간 초과' : (error.message || 'GitHub 조회 실패')
      };
      // Failed requests get a short retry window, not a permanent negative result.
      cache.set(key, { time: Date.now() - ttlMs + 15_000, value });
      return value;
    }
  }

  async function resolveFeature(feature, options = {}) {
    const slots = await Promise.all(feature.prSlots.map((slot) => resolveSlot(slot, options)));
    return { featureId: feature.id, slots, checkedAt: new Date().toISOString() };
  }

  return { resolveSlot, resolveFeature };
}