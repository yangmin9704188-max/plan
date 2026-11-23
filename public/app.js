const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PR_STATUS = {
  merged: ['병합', 'green'],
  open: ['열림', 'blue'],
  draft: ['초안', 'blue'],
  closed: ['미병합 종료', 'red'],
  unavailable: ['조회 불가', 'amber']
};

const ICON = {
  chevron: '<svg class="chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 8l4.5 4.5L14.5 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  doc: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.8h6.5L15 6.3v10.9H5z M11.3 2.8v3.7H15 M7.5 10h5M7.5 13h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  tree: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="5.5" cy="4.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="15.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="14.5" cy="8" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 6.3v7.4M14.5 9.8c0 3-4 2.5-8 4.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  check: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 10.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  merged: '<svg class="step-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="#34d399" opacity=".18"/><path d="M6.5 10.3l2.3 2.3 4.7-5" fill="none" stroke="#34d399" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  open: '<svg class="step-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="#818cf8" stroke-width="1.8"/><circle cx="10" cy="10" r="2.4" fill="#818cf8"/></svg>',
  closed: '<svg class="step-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="#f87171" stroke-width="1.8"/><path d="M7.7 7.7l4.6 4.6M12.3 7.7l-4.6 4.6" stroke="#f87171" stroke-width="1.6" stroke-linecap="round"/></svg>',
  warn: '<svg class="step-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5l7 12.5H3z" fill="none" stroke="#fbbf24" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8.3v3.6M10 13.9v.1" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg>',
  wait: '<svg class="step-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="#64748b" stroke-width="1.6" stroke-dasharray="2.5 2.5"/></svg>'
};

const state = {
  view: 'active',
  data: { active: null, done: null },
  product: '전체',
  search: '',
  open: new Set(),
  busy: false,
  tokenConfigured: true
};

async function api(path, { method = 'GET', body } = {}) {
  const options = { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {} };
  if (body !== undefined) options.body = JSON.stringify(body);
  const response = await fetch(path, options);
  let result;
  try { result = await response.json(); } catch { throw new Error('서버 응답을 읽을 수 없습니다.'); }
  if (!response.ok) throw new Error(result.error || `서버 오류 (${response.status})`);
  return result;
}

let toastTimer;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 3000);
}

const tagColor = new Map();
function tagClass(name) {
  if (!tagColor.has(name)) tagColor.set(name, tagColor.size % 5);
  const n = tagColor.get(name);
  return n ? `tag c${n}` : 'tag';
}

function current() {
  return state.data[state.view];
}

function visibleFeatures() {
  const data = current();
  if (!data) return [];
  const keyword = state.search.trim().toLocaleLowerCase('ko');
  return data.features.filter((f) =>
    (state.product === '전체' || f.products.includes(state.product)) &&
    (!keyword || `${f.title} ${f.plan} ${f.products.join(' ')}`.toLocaleLowerCase('ko').includes(keyword)));
}

function formatTime(iso, withDate = false) {
  if (!iso) return '';
  const date = new Date(iso);
  return withDate
    ? new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
    : date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function renderChrome() {
  const data = current();
  const done = state.view === 'done';
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
  $('#page-title').textContent = done ? '완료' : '대시보드';
  $('#page-subtitle').textContent = done
    ? '완료 처리한 기능입니다. PR은 다시 조회하지 않습니다.'
    : '기획 → 개발 → 내 확인. 확인을 마치면 완료로 넘기세요.';
  const counts = data?.counts || state.data.active?.counts || state.data.done?.counts;
  if (counts) {
    $('#count-active').textContent = counts.active;
    $('#count-done').textContent = counts.done;
  }
  const source = data?.source;
  if (source) {
    $('#source-label').textContent = source.label;
    $('#source-chip').href = source.url || '#';
    $('#source-dot').className = `dot ${data.sourceError ? 'warn' : 'ok'}`;
  }
  $('#sync-time').textContent = data?.syncedAt ? `마지막 조회 ${formatTime(data.syncedAt)}` : '';

  // KPIs
  const list = data?.features || [];
  if (done) {
    $('#kpis').innerHTML = `<span class="kpi green"><span class="dot"></span>완료 <strong>${list.length}</strong>건</span>`;
  } else {
    const issues = list.filter((f) => f.counts.issue > 0).length;
    const waiting = list.filter((f) => f.counts.checks && f.counts.pass + f.counts.issue < f.counts.checks).length;
    $('#kpis').innerHTML = [
      `<span class="kpi"><span>진행 중</span><strong>${list.length}</strong>건</span>`,
      `<span class="kpi amber"><span class="dot"></span>확인 남음 <strong>${waiting}</strong>건</span>`,
      issues ? `<span class="kpi red"><span class="dot"></span>문제 <strong>${issues}</strong>건</span>` : ''
    ].join('');
  }

  // Product tabs (a feature can belong to several products)
  const products = new Map();
  for (const f of list) for (const p of f.products) products.set(p, (products.get(p) || 0) + 1);
  if (state.product !== '전체' && !products.has(state.product)) state.product = '전체';
  const tabs = [['전체', list.length], ...[...products.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))];
  $('#product-tabs').innerHTML = tabs.map(([name, count]) =>
    `<button type="button" role="tab" class="tab ${state.product === name ? 'active' : ''}" aria-selected="${state.product === name}" data-product="${esc(name)}">${esc(name)} (${count})</button>`).join('');

  // Notices
  const notices = [];
  if (data?.sourceError) notices.push(`기능 파일을 읽지 못했습니다: ${esc(data.sourceError)}`);
  if (!state.tokenConfigured && list.some((f) => f.steps.some((s) => s.pr?.status === 'unavailable'))) {
    notices.push('일부 PR을 조회하지 못했습니다. 비공개 저장소라면 <code>.env</code>의 <code>GITHUB_TOKEN</code>이 필요합니다.');
  }
  $('#notices').innerHTML = notices.map((n) => `<div class="notice">${n}</div>`).join('');
}

function stepRow(step) {
  const linked = Boolean(step.branch || step.number);
  let label, tone, icon;
  if (!step.pr) [label, tone, icon] = ['', '', ICON.wait];
  else if (PR_STATUS[step.pr.status]) {
    [label, tone] = PR_STATUS[step.pr.status];
    icon = step.pr.status === 'merged' ? ICON.merged : step.pr.status === 'closed' ? ICON.closed : step.pr.status === 'unavailable' ? ICON.warn : ICON.open;
  } else [label, tone, icon] = [linked ? 'PR 대기' : '브랜치 미연결', linked ? '' : 'amber', ICON.wait];
  const number = step.pr?.number || step.number;
  const prUrl = step.pr?.url || (number && step.repo ? `https://github.com/${step.repo}/pull/${number}` : '');
  const ref = [step.branch, step.repo].filter(Boolean).join(' · ');
  const isOpen = ['open', 'draft'].includes(step.pr?.status);
  return `<div class="step ${isOpen ? 'is-open' : ''}">
    <div class="step-left">${icon}<div class="step-text">
      <span class="step-name"><b>Step ${step.index}</b>— ${esc(step.title)}</span>
      ${ref ? `<span class="step-ref" title="${esc(ref)}">${esc(ref)}</span>` : ''}
    </div></div>
    <div class="step-right">
      ${number ? (prUrl ? `<a class="pr-link" href="${esc(prUrl)}" target="_blank" rel="noopener noreferrer">#${number} ↗</a>` : `<span class="pr-link">#${number}</span>`) : ''}
      ${label ? `<span class="status ${tone}" ${step.pr?.error ? `title="${esc(step.pr.error)}"` : ''}>${esc(label)}</span>` : ''}
    </div>
  </div>`;
}

function checkRow(feature, check, editable) {
  const choice = (result, text) => `<button type="button" class="choice ${check.result === result ? `on-${result}` : ''}" aria-pressed="${check.result === result}" data-action="check" data-feature="${esc(feature.id)}" data-check="${esc(check.id)}" data-result="${result}" ${editable ? '' : 'disabled'}>${text}</button>`;
  const memo = check.result === 'issue'
    ? (editable
      ? `<div class="note-row"><input type="text" maxlength="1000" value="${esc(check.note)}" placeholder="무엇이 문제였는지 메모" aria-label="문제 메모" data-note="${esc(check.id)}"><button type="button" data-action="note" data-feature="${esc(feature.id)}" data-check="${esc(check.id)}">메모 저장</button></div>`
      : (check.note ? `<div class="note-saved">메모: ${esc(check.note)}</div>` : ''))
    : '';
  return `<div class="check ${check.result}"><div class="check-top"><div class="check-text">${esc(check.text)}</div>
    <div class="check-buttons">${choice('pass', '통과')}${choice('issue', '문제')}</div></div>${memo}</div>`;
}

function featureBody(f) {
  const done = state.view === 'done';
  const merged = f.counts.merged;
  const stepsMeta = done ? `${f.counts.steps}단계` : `${merged} / ${f.counts.steps} 병합`;
  const checkMeta = `${f.counts.pass} / ${f.counts.checks} 통과${f.counts.issue ? ` · 문제 ${f.counts.issue}` : ''}`;
  return `<div class="feature-body">
    <div class="card">
      <div class="section-head"><h3 class="section-title">${ICON.doc}기획</h3>
        ${f.url ? `<a class="source-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">원문 ↗</a>` : ''}</div>
      ${f.plan ? `<p class="plan-text">${esc(f.plan)}</p>` : '<span class="empty-text">기획 내용이 아직 없습니다.</span>'}
      ${f.warnings.length ? `<ul class="warnings">${f.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    </div>
    <div class="columns">
      <div>
        <div class="section-head"><h3 class="section-title">${ICON.tree}개발</h3>
          <span class="section-meta ${!done && f.counts.steps && merged === f.counts.steps ? 'green' : ''}">${stepsMeta}</span></div>
        ${f.steps.length ? `<div class="rows">${f.steps.map(stepRow).join('')}</div>` : '<span class="empty-text">개발 계획이 아직 없습니다.</span>'}
      </div>
      <div>
        <div class="section-head"><h3 class="section-title amber">${ICON.check}내 확인</h3>
          <span class="section-meta amber">${checkMeta}</span></div>
        ${f.checks.length ? `<div class="rows">${f.checks.map((c) => checkRow(f, c, !done)).join('')}</div>` : '<span class="empty-text">확인 항목이 아직 없습니다.</span>'}
      </div>
    </div>
    ${done
      ? `<div class="done-banner"><span>${formatTime(f.completedAt, true)} 완료 처리</span><button type="button" class="button button-quiet" data-action="reopen" data-feature="${esc(f.id)}">대시보드로 되돌리기</button></div>`
      : `<div class="feature-foot"><span class="foot-hint">화면 확인을 마쳤다면 완료로 넘기세요. 완료한 기능은 PR을 다시 조회하지 않습니다.</span><button type="button" class="button button-done" data-action="complete" data-feature="${esc(f.id)}">완료 처리</button></div>`}
  </div>`;
}

function featureItem(f) {
  const done = state.view === 'done';
  const opened = state.open.has(`${state.view}:${f.id}`);
  const firstLine = f.plan.split('\n').find((line) => line.trim()) || '';
  const summary = done
    ? `<span class="done-chip">${formatTime(f.completedAt, true)} 완료</span>`
    : `<span class="summary-chip">${f.counts.merged}/${f.counts.steps} 병합 · ${f.counts.pass}/${f.counts.checks} 통과</span>`;
  return `<article class="feature ${opened ? 'open' : ''} ${f.counts.issue && !done ? 'has-issue' : ''}" data-id="${esc(f.id)}">
    <button type="button" class="feature-head" data-action="toggle" data-feature="${esc(f.id)}" aria-expanded="${opened}">
      <div class="head-left">
        ${f.products.length ? `<span class="tags">${f.products.map((p) => `<span class="${tagClass(p)}">${esc(p)}</span>`).join('')}</span>` : ''}
        <span class="feature-title">${esc(f.title)}</span>
        <span class="feature-hint">${esc(firstLine.replace(/^[#>*\-\s]+/, ''))}</span>
      </div>
      <div class="head-right">
        ${summary}
        ${f.counts.issue && !done ? `<span class="issue-chip">문제 ${f.counts.issue}</span>` : ''}
        ${ICON.chevron}
      </div>
    </button>
    ${opened ? featureBody(f) : ''}
  </article>`;
}

function renderList() {
  const data = current();
  const list = $('#feature-list');
  if (!data) { list.innerHTML = '<div class="empty">불러오는 중…</div>'; return; }
  const features = visibleFeatures();
  if (!features.length) {
    list.innerHTML = data.features.length
      ? '<div class="empty"><b>검색 결과가 없습니다.</b>검색어나 제품 탭을 바꿔보세요.</div>'
      : state.view === 'done'
        ? '<div class="empty"><b>완료한 기능이 없습니다.</b>대시보드에서 확인을 마친 기능을 완료 처리하면 여기로 옮겨집니다.</div>'
        : `<div class="empty"><b>진행 중인 기능이 없습니다.</b>GPT가 <code>${esc(data.source?.label || 'features/')}</code>에 기능 파일을 올리면 새로고침했을 때 나타납니다.</div>`;
    return;
  }
  list.innerHTML = features.map(featureItem).join('');
}

function render() {
  renderChrome();
  renderList();
}

function rerenderFeature(id) {
  const feature = current()?.features.find((f) => f.id === id);
  const element = document.querySelector(`.feature[data-id="${CSS.escape(id)}"]`);
  if (!feature || !element) return render();
  element.outerHTML = featureItem(feature);
  renderChrome();
}

function setBusy(busy) {
  state.busy = busy;
  const button = $('#refresh-button');
  button.disabled = busy;
  button.classList.toggle('spinning', busy);
}

async function load(view, { refresh = false } = {}) {
  if (refresh) setBusy(true);
  try {
    const data = refresh
      ? await api(`/api/refresh?view=${view}`, { method: 'POST' })
      : await api(`/api/board?view=${view}`);
    state.data[view] = data;
    if (refresh) {
      // Other view is stale after a sync; reload lazily when opened.
      state.data[view === 'active' ? 'done' : 'active'] = null;
      toast('GitHub에서 다시 읽었습니다.');
    }
  } catch (error) {
    toast(error.message);
  } finally {
    if (refresh) setBusy(false);
    if (view === state.view) render();
  }
}

function recount(feature) {
  feature.counts.pass = feature.checks.filter((c) => c.result === 'pass').length;
  feature.counts.issue = feature.checks.filter((c) => c.result === 'issue').length;
}

async function saveCheck(featureId, checkId, result, note) {
  const feature = current()?.features.find((f) => f.id === featureId);
  const check = feature?.checks.find((c) => c.id === checkId);
  if (!check) return;
  const previous = { result: check.result, note: check.note };
  Object.assign(check, { result, note });
  recount(feature);
  rerenderFeature(featureId);
  try {
    await api(`/api/features/${encodeURIComponent(featureId)}/checks/${encodeURIComponent(checkId)}`, { method: 'PATCH', body: { result, note } });
  } catch (error) {
    Object.assign(check, previous);
    recount(feature);
    rerenderFeature(featureId);
    toast(error.message);
  }
}

async function setCompleted(featureId, complete) {
  const feature = current()?.features.find((f) => f.id === featureId);
  if (complete && feature) {
    const left = feature.counts.checks - feature.counts.pass;
    if (left > 0 && !confirm(`'${feature.title}'에 통과하지 않은 확인 항목이 ${left}개 있습니다.\n그래도 완료로 넘길까요?`)) return;
  }
  try {
    await api(`/api/features/${encodeURIComponent(featureId)}/${complete ? 'complete' : 'reopen'}`, { method: 'POST' });
    state.data = { active: null, done: null };
    state.open.delete(`${state.view}:${featureId}`);
    await load(state.view);
    toast(complete ? '완료 메뉴로 옮겼습니다.' : '대시보드로 되돌렸습니다.');
  } catch (error) { toast(error.message); }
}

function init() {
  $('#refresh-button').addEventListener('click', () => { if (!state.busy) load(state.view, { refresh: true }); });
  document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => {
    if (state.view === item.dataset.view) return;
    state.view = item.dataset.view;
    state.product = '전체';
    render();
    if (!state.data[state.view]) load(state.view);
  }));
  $('#search').addEventListener('input', (event) => { state.search = event.target.value; renderList(); });
  $('#product-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-product]');
    if (tab) { state.product = tab.dataset.product; render(); }
  });
  $('#feature-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, feature, check } = button.dataset;
    if (action === 'toggle') {
      const key = `${state.view}:${feature}`;
      if (state.open.has(key)) state.open.delete(key); else state.open.add(key);
      return rerenderFeature(feature);
    }
    if (action === 'check') {
      const item = current()?.features.find((f) => f.id === feature)?.checks.find((c) => c.id === check);
      if (!item) return;
      // Clicking the selected choice again clears it back to 미확인.
      const result = item.result === button.dataset.result ? 'pending' : button.dataset.result;
      return saveCheck(feature, check, result, result === 'issue' ? item.note : '');
    }
    if (action === 'note') {
      const input = button.parentElement.querySelector('input');
      return saveCheck(feature, check, 'issue', input.value).then(() => toast('메모를 저장했습니다.'));
    }
    if (action === 'complete') return setCompleted(feature, true);
    if (action === 'reopen') return setCompleted(feature, false);
  });
  $('#feature-list').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[data-note]')) event.target.nextElementSibling?.click();
  });

  api('/api/health').then((health) => { state.tokenConfigured = health.githubTokenConfigured; }).catch(() => {});
  render();
  load('active');
}

init();
