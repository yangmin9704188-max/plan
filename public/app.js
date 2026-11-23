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
  data: { active: null, done: null, menus: null },
  audience: '전체',
  recentOnly: false,
  uncheckedOnly: false,
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

function productTags(f) {
  return f.products.length ? `<span class="tags">${f.products.map((p) => `<span class="${tagClass(p)}">${esc(p)}</span>`).join('')}</span>` : '';
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

// ---------- 메뉴별 기능 (Office docs/feature-cards) ----------

const CARD_STATUS = { '준비 중': '', '개발 중': 'blue', '병합': 'green', '배포됨': 'green' };
const RECENT_DAYS = 7;

function isRecent(card) {
  const latest = card.history[0]?.date;
  if (!latest) return false;
  return (Date.now() - Date.parse(`${latest}T00:00:00+09:00`)) / 86_400_000 <= RECENT_DAYS;
}

function cardCounts(card) {
  return {
    pass: card.checks.filter((c) => c.result === 'pass').length,
    issue: card.checks.filter((c) => c.result === 'issue').length,
    total: card.checks.length,
  };
}

function needsCheck(card) {
  const c = cardCounts(card);
  return c.total > 0 && c.pass + c.issue < c.total;
}

function visibleMenus() {
  const data = state.data.menus;
  if (!data) return [];
  const keyword = state.search.trim().toLocaleLowerCase('ko');
  return data.menus.map((menu) => ({
    ...menu,
    cards: menu.cards.filter((card) =>
      (state.audience === '전체' || card.audience.includes(state.audience)) &&
      (!state.recentOnly || isRecent(card)) &&
      (!state.uncheckedOnly || needsCheck(card) || cardCounts(card).issue > 0) &&
      (!keyword || `${card.id} ${card.title} ${card.location} ${menu.menu} ${card.apis.map((a) => a.path).join(' ')}`.toLocaleLowerCase('ko').includes(keyword))),
  })).filter((menu) => menu.cards.length);
}

function renderMenusChrome(data) {
  const cards = data?.menus.flatMap((m) => m.cards) || [];
  $('#count-menus').textContent = data ? cards.length : '·';
  $('#page-title').textContent = '메뉴별 기능';
  $('#page-subtitle').textContent = '화면별로 지금 되는 기능, 최근 바뀐 것, 확인할 것을 봅니다. (Office 기능 카드)';
  if (data?.source) {
    $('#source-label').textContent = data.source.label;
    $('#source-chip').href = data.source.url || '#';
    $('#source-dot').className = `dot ${data.sourceError || data.problems.length ? 'warn' : 'ok'}`;
  }
  $('#sync-time').textContent = data?.syncedAt ? `마지막 조회 ${formatTime(data.syncedAt)}` : '';
  const built = cards.filter((c) => c.status !== '준비 중');
  const issues = cards.filter((c) => cardCounts(c).issue > 0).length;
  $('#kpis').innerHTML = [
    `<span class="kpi"><span>기능</span><strong>${built.length}</strong>개</span>`,
    `<span class="kpi"><span>준비 중</span><strong>${cards.length - built.length}</strong>개</span>`,
    `<span class="kpi green"><span class="dot"></span>최근 ${RECENT_DAYS}일 변경 <strong>${cards.filter(isRecent).length}</strong></span>`,
    `<span class="kpi amber"><span class="dot"></span>확인 남음 <strong>${cards.filter(needsCheck).length}</strong></span>`,
    issues ? `<span class="kpi red"><span class="dot"></span>문제 <strong>${issues}</strong></span>` : '',
  ].join('');
  const audiences = new Map();
  for (const c of cards) for (const a of c.audience) audiences.set(a, (audiences.get(a) || 0) + 1);
  if (state.audience !== '전체' && !audiences.has(state.audience)) state.audience = '전체';
  const tabs = [['전체', cards.length], ...audiences.entries()];
  $('#product-tabs').innerHTML = tabs.map(([name, count]) =>
    `<button type="button" role="tab" class="tab ${state.audience === name ? 'active' : ''}" aria-selected="${state.audience === name}" data-audience="${esc(name)}">${esc(name)} (${count})</button>`).join('') +
    `<button type="button" class="tab toggle ${state.recentOnly ? 'active' : ''}" aria-pressed="${state.recentOnly}" data-toggle="recentOnly">최근 ${RECENT_DAYS}일 변경</button>` +
    `<button type="button" class="tab toggle ${state.uncheckedOnly ? 'active' : ''}" aria-pressed="${state.uncheckedOnly}" data-toggle="uncheckedOnly">확인 남음·문제</button>`;
  $('#search').placeholder = '기능 ID, 이름, 화면 위치, API 검색';
  const notices = [];
  if (data?.sourceError) notices.push(`기능 카드를 읽지 못했습니다: ${esc(data.sourceError)}`);
  if (data?.problems.length) notices.push(`카드 형식 오류 ${data.problems.length}건: ${data.problems.slice(0, 3).map(esc).join(' · ')}`);
  $('#notices').innerHTML = notices.map((n) => `<div class="notice">${n}</div>`).join('');
}

function cardBody(card, policies) {
  const policyChips = card.policies.map((id) => {
    const p = policies.get(id);
    return `<span class="policy-chip" title="${esc(p ? `${p.rule}\n근거: ${p.basis}` : '정책 카드 없음')}">${esc(id)}${p ? ` · ${esc(p.title)}` : ''}</span>`;
  }).join('');
  const history = card.history.map((h) => `<li><span class="h-date">${esc(h.date)}</span> <span class="h-kind">${esc(h.kind)}</span> ${h.prs.map((n) => `<a class="pr-link" href="https://github.com/yangmin9704188-max/jakupan_office_web/pull/${n}" target="_blank" rel="noopener noreferrer">#${n}</a>`).join(' ')} ${esc(h.detail.replace(/#\d+\s*/g, ''))}</li>`).join('');
  const counts = cardCounts(card);
  return `<div class="feature-body">
    <div class="card card-grid">
      <div><div class="plan-label">화면 위치</div><div>${esc(card.location)}</div></div>
      ${card.note ? `<div><div class="plan-label">메모</div><div>${esc(card.note)}</div></div>` : ''}
      ${policyChips ? `<div><div class="plan-label">정책</div><div class="chips">${policyChips}</div></div>` : ''}
      ${history ? `<div><div class="plan-label">이력</div><ul class="history">${history}</ul></div>` : ''}
      ${card.apis.length ? `<details class="plan-fold"><summary>API ${card.apis.length}개</summary><ul class="api-list">${card.apis.map((a) => `<li><code>${esc(a.method || '')} ${esc(a.path || a.text)}</code>${a.note ? ` — ${esc(a.note)}` : ''}</li>`).join('')}</ul></details>` : ''}
      ${card.data.length ? `<details class="plan-fold"><summary>데이터 ${card.data.length}개</summary><ul class="api-list">${card.data.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>` : ''}
      ${card.performance.length ? `<div><div class="plan-label">성능</div><ul class="history">${card.performance.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    </div>
    <div>
      <div class="section-head"><h3 class="section-title amber">${ICON.check}내 확인</h3>
        <span class="section-meta amber">${counts.pass} / ${counts.total} 통과${counts.issue ? ` · 문제 ${counts.issue}` : ''}</span></div>
      ${card.checks.length ? `<div class="rows check-list">${card.checks.map((c) => checkRow({ id: card.id }, c, true).replaceAll('data-action="check"', 'data-action="card-check"').replaceAll('data-action="note"', 'data-action="card-note"')).join('')}</div>` : '<span class="empty-text">아직 만들어지지 않은 기능입니다.</span>'}
    </div>
  </div>`;
}

function cardItem(card, policies) {
  const opened = state.open.has(`menus:${card.id}`);
  const counts = cardCounts(card);
  const tone = CARD_STATUS[card.status] ?? '';
  return `<article class="feature card-item ${opened ? 'open' : ''} ${counts.issue ? 'has-issue' : ''}" data-id="${esc(card.id)}">
    <button type="button" class="feature-head" data-action="card-toggle" data-feature="${esc(card.id)}" aria-expanded="${opened}">
      <div class="head-left"><span class="card-id">${esc(card.id)}</span><span class="feature-title">${esc(card.title)}</span>
        ${card.audience.map((a) => `<span class="${tagClass(a)}">${esc(a)}</span>`).join('')}</div>
      <div class="head-right">
        ${isRecent(card) ? `<span class="status green">${esc(card.history[0].date.slice(5))} ${esc(card.history[0].kind)}</span>` : ''}
        ${counts.total ? `<span class="summary-chip">${counts.pass}/${counts.total} 통과</span>` : ''}
        <span class="status ${tone}">${esc(card.status)}</span>${ICON.chevron}</div>
    </button>
    ${opened ? cardBody(card, policies) : ''}
  </article>`;
}

function renderMenus() {
  const data = state.data.menus;
  const list = $('#feature-list');
  if (!data) { list.innerHTML = '<div class="empty">불러오는 중…</div>'; return; }
  const menus = visibleMenus();
  if (!menus.length) {
    list.innerHTML = data.menus.length
      ? '<div class="empty"><b>조건에 맞는 기능이 없습니다.</b>대상 탭이나 필터를 바꿔보세요.</div>'
      : '<div class="empty"><b>기능 카드가 아직 없습니다.</b>Office 저장소 docs/feature-cards에 메뉴 파일이 올라오면 새로고침했을 때 나타납니다.</div>';
    return;
  }
  const policies = new Map(data.policies.map((p) => [p.id, p]));
  list.innerHTML = menus.map((menu) => {
    const built = menu.cards.filter((c) => c.status !== '준비 중');
    const pending = menu.cards.filter((c) => c.status === '준비 중');
    return `<section class="menu-group">
      <div class="menu-head"><h2>${esc(menu.menu)}</h2>
        ${menu.url ? `<a class="source-link" href="${esc(menu.url)}" target="_blank" rel="noopener noreferrer">카드 원문 ↗</a>` : ''}</div>
      ${built.map((c) => cardItem(c, policies)).join('')}
      ${pending.length ? `<div class="menu-sub">준비 중 ${pending.length}</div>${pending.map((c) => cardItem(c, policies)).join('')}` : ''}
    </section>`;
  }).join('');
  fitCheckLists(list);
}

async function loadMenus({ refresh = false } = {}) {
  if (refresh) setBusy(true);
  try {
    state.data.menus = refresh ? await api('/api/menus/refresh', { method: 'POST' }) : await api('/api/menus');
    if (refresh) toast('기능 카드를 다시 읽었습니다.');
  } catch (error) {
    toast(error.message);
  } finally {
    if (refresh) setBusy(false);
    if (state.view === 'menus') render();
  }
}

async function saveCardCheck(cardId, checkId, result, note) {
  const card = state.data.menus?.menus.flatMap((m) => m.cards).find((c) => c.id === cardId);
  const check = card?.checks.find((c) => c.id === checkId);
  if (!check) return;
  const previous = { result: check.result, note: check.note };
  Object.assign(check, { result, note });
  render();
  try {
    await api(`/api/cards/${encodeURIComponent(cardId)}/checks/${encodeURIComponent(checkId)}`, { method: 'PATCH', body: { result, note } });
  } catch (error) {
    Object.assign(check, previous);
    render();
    toast(error.message);
  }
}

function renderChrome() {
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
  if (state.view === 'menus') return renderMenusChrome(state.data.menus);
  $('#search').placeholder = '기능명, 기획 내용 검색';
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
    notices.push('일부 PR을 조회하지 못했습니다. 비공개 저장소라면 <code>gh auth login</code>으로 로그인하거나 <code>.env</code>에 <code>GITHUB_TOKEN</code>을 넣고 서버를 다시 켜세요.');
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

// Minimal, safe Markdown: paragraphs and "- " lists, with **bold** and `code`.
function inline(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function richText(text) {
  const out = [];
  let list = null;
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  for (const line of text.split('\n')) {
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flush();
      list ??= [];
      list.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (line.trim()) paragraph.push(line.trim()); else flush();
  }
  flush();
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return `<div class="rich">${out.join('')}</div>`;
}

function planBlocks(sections) {
  return `<div class="plan-parts">${sections.map((s) => {
    if (s.key === 'intro') return `<div class="plan-part">${richText(s.text)}</div>`;
    if (s.folded) return `<details class="plan-fold"><summary>${esc(s.label)}</summary>${richText(s.text)}</details>`;
    return `<div class="plan-part"><div class="plan-label">${esc(s.label)}</div>${richText(s.text)}</div>`;
  }).join('')}</div>`;
}

function featureBody(f) {
  const done = state.view === 'done';
  const merged = f.counts.merged;
  const stepsMeta = done ? `${f.counts.steps}단계` : `${merged} / ${f.counts.steps} 병합`;
  const checkMeta = `${f.counts.pass} / ${f.counts.checks} 통과${f.counts.issue ? ` · 문제 ${f.counts.issue}` : ''}`;
  const meta = [
    done ? '' : `<span class="summary-chip">${merged}/${f.counts.steps} 병합 · ${f.counts.pass}/${f.counts.checks} 통과</span>`,
    f.counts.issue && !done ? `<span class="issue-chip">문제 ${f.counts.issue}</span>` : ''
  ].join('');
  return `<div class="feature-body">
    ${meta.trim() ? `<div class="body-meta">${meta}</div>` : ''}
    <div class="card">
      <div class="section-head"><h3 class="section-title">${ICON.doc}기획</h3>
        ${f.url ? `<a class="source-link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">원문 ↗</a>` : ''}</div>
      ${f.planSections?.length ? planBlocks(f.planSections) : '<span class="empty-text">기획 내용이 아직 없습니다.</span>'}
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
        ${f.checks.length ? `<div class="rows check-list" data-checks="${esc(f.id)}">${f.checks.map((c) => checkRow(f, c, !done)).join('')}</div>` : '<span class="empty-text">확인 항목이 아직 없습니다.</span>'}
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
  // Collapsed rows show only product badges and the title; the rest appears when opened.
  return `<article class="feature ${opened ? 'open' : ''}" data-id="${esc(f.id)}">
    <button type="button" class="feature-head" data-action="toggle" data-feature="${esc(f.id)}" aria-expanded="${opened}">
      <div class="head-left">${productTags(f)}<span class="feature-title">${esc(f.title)}</span></div>
      <div class="head-right">${ICON.chevron}</div>
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
  fitCheckLists(list);
}

function render() {
  renderChrome();
  if (state.view === 'menus') renderMenus(); else renderList();
}

// The 내 확인 list shows about 8 items; the rest scrolls with the wheel (scrollbar hidden).
const VISIBLE_CHECKS = 8;

function updateFade(list) {
  const more = list.scrollHeight - list.scrollTop - list.clientHeight > 2;
  list.classList.toggle('fade-bottom', more);
  list.classList.toggle('fade-top', list.scrollTop > 2);
}

function fitCheckLists(root = document) {
  root.querySelectorAll('.check-list').forEach((list) => {
    list.style.maxHeight = '';
    const items = list.children;
    if (items.length > VISIBLE_CHECKS) {
      const last = items[VISIBLE_CHECKS - 1];
      // .check-list is position: relative, so offsetTop is measured from the list itself.
      list.style.maxHeight = `${last.offsetTop + last.offsetHeight}px`;
    }
    updateFade(list);
  });
}

function rerenderFeature(id) {
  const feature = current()?.features.find((f) => f.id === id);
  const element = document.querySelector(`.feature[data-id="${CSS.escape(id)}"]`);
  if (!feature || !element) return render();
  const scrollTop = element.querySelector('.check-list')?.scrollTop || 0;
  element.outerHTML = featureItem(feature);
  const fresh = document.querySelector(`.feature[data-id="${CSS.escape(id)}"]`);
  if (fresh) {
    fitCheckLists(fresh);
    const list = fresh.querySelector('.check-list');
    if (list) { list.scrollTop = scrollTop; updateFade(list); }
  }
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
  $('#refresh-button').addEventListener('click', () => {
    if (state.busy) return;
    if (state.view === 'menus') loadMenus({ refresh: true }); else load(state.view, { refresh: true });
  });
  document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => {
    if (state.view === item.dataset.view) return;
    state.view = item.dataset.view;
    state.product = '전체';
    render();
    if (!state.data[state.view]) {
      if (state.view === 'menus') loadMenus(); else load(state.view);
    }
  }));
  $('#search').addEventListener('input', (event) => {
    state.search = event.target.value;
    if (state.view === 'menus') renderMenus(); else renderList();
  });
  $('#product-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-product]');
    if (tab) { state.product = tab.dataset.product; render(); return; }
    const audience = event.target.closest('[data-audience]');
    if (audience) { state.audience = audience.dataset.audience; render(); return; }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) { state[toggle.dataset.toggle] = !state[toggle.dataset.toggle]; render(); }
  });
  $('#feature-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, feature, check } = button.dataset;
    if (action === 'card-toggle') {
      const key = `menus:${feature}`;
      if (state.open.has(key)) state.open.delete(key); else state.open.add(key);
      return render();
    }
    if (action === 'card-check') {
      const item = state.data.menus?.menus.flatMap((m) => m.cards).find((c) => c.id === feature)?.checks.find((c) => c.id === check);
      if (!item) return;
      const result = item.result === button.dataset.result ? 'pending' : button.dataset.result;
      return saveCardCheck(feature, check, result, result === 'issue' ? item.note : '');
    }
    if (action === 'card-note') {
      const input = button.parentElement.querySelector('input');
      return saveCardCheck(feature, check, 'issue', input.value).then(() => toast('메모를 저장했습니다.'));
    }
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

  $('#feature-list').addEventListener('scroll', (event) => {
    if (event.target.classList?.contains('check-list')) updateFade(event.target);
  }, true);
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => fitCheckLists(), 150); });

  api('/api/health').then((health) => { state.tokenConfigured = health.githubTokenConfigured; }).catch(() => {});
  render();
  load('active');
}

init();
