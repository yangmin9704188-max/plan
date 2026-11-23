const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const products = ['전체', 'Office', 'Worker', 'Works', 'Network', 'Market', '기타'];
const statuses = {
  planned: ['연결 대기', 'neutral'],
  draft: ['초안 PR', 'blue'],
  open: ['PR 열림', 'blue'],
  merged: ['병합 완료', 'green'],
  closed: ['미병합 종료', 'red'],
  unavailable: ['조회 불가', 'amber'],
  loading: ['조회 중', 'neutral']
};
const state = {
  features: [], progress: {}, selectedId: null, filter: '전체', search: '',
  editorId: null, preview: { specification: false, developmentPlan: false },
  githubConfigured: false, fetching: false
};

async function api(path, { method = 'GET', body } = {}) {
  const options = { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {} };
  if (body !== undefined) options.body = JSON.stringify(body);
  const response = await fetch(path, options);
  let result;
  try { result = await response.json(); }
  catch { throw new Error('서버 응답을 읽을 수 없습니다.'); }
  if (!response.ok) throw new Error(result.error || `서버 오류 (${response.status})`);
  return result;
}

let toastTimer;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 3100);
}

function featureProgress(feature) {
  const slots = state.progress[feature.id]?.slots || [];
  const plannedCount = feature.prSlots.length;
  const merged = slots.filter((slot) => slot.status === 'merged').length;
  const issue = feature.checks.filter((check) => check.result === 'issue').length;
  const passed = feature.checks.filter((check) => check.result === 'pass').length;
  const hasPrError = slots.some((slot) => slot.status === 'unavailable');
  let name = '개발 준비', tone = 'neutral';
  if (issue) [name, tone] = ['확인 문제', 'red'];
  else if (feature.checks.length && passed === feature.checks.length) [name, tone] = ['내 확인 완료', 'green'];
  else if (plannedCount && merged === plannedCount) [name, tone] = ['내 확인 대기', 'amber'];
  else if (slots.some((slot) => ['open', 'draft', 'merged', 'closed'].includes(slot.status))) [name, tone] = ['PR 진행 중', 'blue'];
  else if (plannedCount === 0 && !feature.specification && !feature.specificationUrl && !feature.developmentPlan && !feature.developmentPlanUrl) [name, tone] = ['기획 중', 'neutral'];
  return { name, tone, merged, plannedCount, issue, passed, hasPrError };
}

function badge(name, tone) {
  return `<span class="status ${esc(tone)}">${esc(name)}</span>`;
}

function renderFilters() {
  $('#product-filters').innerHTML = products.map((product) => {
    const count = product === '전체' ? state.features.length : state.features.filter((f) => f.product === product).length;
    return `<button type="button" class="filter-button ${state.filter === product ? 'active' : ''}" data-filter="${esc(product)}" aria-pressed="${state.filter === product}"><span class="filter-dot"></span>${esc(product)}<span class="filter-count">${count}</span></button>`;
  }).join('');
}

function renderSummary() {
  let merged = 0, planned = 0, pending = 0;
  for (const feature of state.features) {
    const progress = featureProgress(feature);
    merged += progress.merged;
    planned += progress.plannedCount;
    if (progress.name === '내 확인 대기' || progress.name === '확인 문제') pending++;
  }
  const cards = [
    ['등록된 기능', state.features.length, '▤', ''],
    ['병합된 PR', `${merged} / ${planned}`, '✓', 'blue'],
    ['내 확인 필요', pending, '◎', 'green']
  ];
  $('#summary').innerHTML = cards.map(([label, number, symbol, tone]) => `<div class="metric"><div><div class="metric-label">${label}</div><div class="metric-number">${number}</div></div><div class="metric-icon ${tone}">${symbol}</div></div>`).join('');
}

function renderList() {
  const keyword = state.search.trim().toLocaleLowerCase('ko');
  const visible = state.features.filter((f) =>
    (state.filter === '전체' || f.product === state.filter) &&
    (!keyword || `${f.title} ${f.summary} ${f.product}`.toLocaleLowerCase('ko').includes(keyword))
  );
  $('#feature-count').textContent = visible.length;
  $('#feature-list').innerHTML = visible.length ? visible.map((f) => {
    const p = featureProgress(f);
    return `<button class="feature-item ${state.selectedId === f.id ? 'active' : ''}" data-feature-id="${esc(f.id)}" aria-pressed="${state.selectedId === f.id}">
      <div class="item-top"><span class="product-tag">${esc(f.product)}</span>${badge(p.name, p.tone)}</div>
      <div class="item-title">${esc(f.title)}</div>
      <div class="item-description">${esc(f.summary || '설명 없음')}</div>
      <div class="item-meta"><span class="pr-fraction">PR 병합 ${p.merged}/${p.plannedCount}${p.hasPrError ? ' · 조회 오류' : ''}</span><span class="pr-fraction">확인 ${p.passed}/${f.checks.length}</span></div>
    </button>`;
  }).join('') : `<div class="empty-list"><b>${state.features.length ? '검색 결과가 없습니다.' : '아직 등록된 기능이 없습니다.'}</b>${state.features.length ? '검색어 또는 제품 필터를 바꿔보세요.' : '우측 상단의 기능 등록으로 시작하세요.'}</div>`;
}

function link(url, text) {
  return url ? `<a class="inline-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>` : '';
}

function docCard(title, body, url, key) {
  const hasBody = Boolean(body);
  const opened = state.preview[key];
  const preview = hasBody ? (body.length > 170 ? `${body.slice(0, 170)}…` : body) : (url ? 'GitHub 문서가 연결되어 있습니다.' : '아직 등록되지 않았습니다.');
  return `<div class="doc-card"><div class="doc-label">${title}</div><div class="doc-excerpt">${esc(preview)}</div>
    <div class="doc-actions">${link(url, 'GitHub 원문')} ${hasBody ? `<button class="inline-button" type="button" data-action="toggle-document" data-document="${key}">${opened ? '본문 접기' : '본문 보기'}</button>` : ''} ${!hasBody && !url ? '<span class="doc-empty">미등록</span>' : ''}</div>
    ${hasBody && opened ? `<div class="doc-preview">${esc(body)}</div>` : ''}</div>`;
}

function prRow(slot, index, progress) {
  const status = progress?.status || (state.fetching ? 'loading' : 'planned');
  const [statusText, tone] = statuses[status] || statuses.planned;
  const prUrl = progress?.url || (slot.number && slot.repo ? `https://github.com/${slot.repo}/pull/${slot.number}` : '');
  const branchLabel = slot.branch ? `<code>${esc(slot.branch)}</code>` : slot.number ? `<code>#${slot.number}</code>` : '<span>브랜치/번호 미지정</span>';
  const errorMessage = progress?.error ? `<span title="${esc(progress.error)}"> · ${esc(progress.error)}</span>` : '';
  return `<div class="pr-row">
    <div><div class="pr-name">${esc(slot.label || `PR${String(index + 1).padStart(2, '0')}`)}</div>
    <div class="pr-hint">${esc(slot.repo || '저장소 미설정')} <span>·</span>${branchLabel} ${progress?.number ? `<span>· #${progress.number}</span>` : ''}${errorMessage}</div></div>
    <div class="pr-right">${badge(statusText, tone)} ${prUrl ? `<a href="${esc(prUrl)}" target="_blank" rel="noopener noreferrer">PR 보기 ↗</a>` : ''}</div>
  </div>`;
}

function checkCard(check) {
  const choice = (result, label) => `<button type="button" class="check-choice ${check.result === result ? `selected-${result}` : ''}" data-action="set-check" data-check-id="${esc(check.id)}" data-result="${result}" aria-pressed="${check.result === result}">${label}</button>`;
  return `<div class="check-card" data-check-card="${esc(check.id)}"><div class="check-top"><div class="check-text">${esc(check.text)}</div>
    <div class="check-buttons">${choice('pending', '미확인')}${choice('pass', '통과')}${choice('issue', '문제')}</div></div>
    <div class="note-row"><input class="note-input" type="text" maxlength="1000" placeholder="선택 사항: 발견한 문제나 확인 메모" value="${esc(check.note || '')}" aria-label="확인 메모"><button type="button" data-action="save-note" data-check-id="${esc(check.id)}">메모 저장</button></div>
  </div>`;
}

function renderDetail() {
  const feature = state.features.find((item) => item.id === state.selectedId);
  if (!feature) {
    $('#detail').innerHTML = `<div class="empty-detail"><div class="empty-icon">▤</div><h2>기능을 선택하세요</h2><p>등록된 기능의 기획, PR 병합 현황, 직접 확인 체크리스트를 볼 수 있습니다.</p></div>`;
    return;
  }
  const progress = featureProgress(feature);
  const slots = state.progress[feature.id]?.slots || [];
  const checkedWidth = feature.checks.length ? Math.round(progress.passed / feature.checks.length * 100) : 0;
  const shortDate = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(feature.createdAt));
  $('#detail').innerHTML = `
    <div class="detail-top"><div><div class="detail-kicker">${esc(feature.product.toUpperCase())} · FEATURE</div><h2 class="detail-title">${esc(feature.title)}</h2><p class="detail-summary">${esc(feature.summary || '요약 설명이 없습니다.')}</p></div>
      <div class="detail-actions"><button type="button" class="icon-button" data-action="edit" title="기능 수정" aria-label="기능 수정">✎</button><button type="button" class="icon-button" data-action="delete" title="기능 삭제" aria-label="기능 삭제">×</button></div></div>
    <div class="detail-info">${badge(progress.name, progress.tone)}<span class="info-divider"></span><span class="info-block">PR 병합 <strong>${progress.merged} / ${progress.plannedCount}</strong></span><span class="info-divider"></span><span class="info-block">내 확인 <strong>${progress.passed} / ${feature.checks.length}</strong></span><span class="info-divider"></span><span class="info-block">등록 <strong>${esc(shortDate)}</strong></span></div>
    <section class="section"><div class="section-header"><h3>확정 문서</h3><span class="section-subtitle">기획은 한 번 등록 · 문서 원문은 GitHub에서 유지</span></div><div class="document-grid">
    ${docCard('최종 기획서', feature.specification, feature.specificationUrl, 'specification')}
    ${docCard('개발계획서', feature.developmentPlan, feature.developmentPlanUrl, 'developmentPlan')}</div></section>
    <section class="section"><div class="section-header"><h3>GitHub PR 진행 현황</h3><span class="section-subtitle">${progress.merged} / ${progress.plannedCount} 병합</span></div>
    <div class="progress-note">PR 상태는 GitHub에서 직접 읽습니다. 병합 여부는 실제 화면 반영·작동 검증을 의미하지 않습니다.${progress.hasPrError ? '<br>일부 PR 조회에 실패했습니다. 토큰 권한이나 API 한도를 확인하세요.' : ''}</div>
    ${feature.prSlots.length ? `<div class="pr-list">${feature.prSlots.map((slot, i) => prRow(slot, i, slots[i])).join('')}</div>` : '<p class="hint-text">연결된 PR 계획이 없습니다. 기능을 수정해 저장소와 브랜치 또는 PR 번호를 등록하세요.</p>'}</section>
    <section class="section"><div class="section-header"><h3>내 확인 체크리스트</h3><span class="section-subtitle">대표님이 직접 확인한 결과만 저장</span></div>
    <div class="check-progress"><div class="check-bar"><div class="check-bar-fill" style="width:${checkedWidth}%"></div></div><span class="check-number">${progress.passed} / ${feature.checks.length} 통과</span></div>
    ${feature.checks.length ? `<div class="checks">${feature.checks.map(checkCard).join('')}</div>` : '<p class="hint-text">확인할 항목을 등록하지 않았습니다. 기능을 수정해 화면 사용 확인 항목을 추가하세요.</p>'}</section>`;
}

function render() {
  renderFilters(); renderSummary(); renderList(); renderDetail();
}

function selectFeature(id) {
  state.selectedId = id;
  state.preview = { specification: false, developmentPlan: false };
  renderList(); renderDetail();
}

async function refreshProgress(force = false) {
  if (state.fetching) return;
  state.fetching = true;
  $('#refresh-button').disabled = true;
  $('#sync-message').textContent = 'GitHub PR 상태 조회 중…';
  try {
    const response = await api(`/api/progress${force ? '?refresh=1' : ''}`);
    state.progress = Object.fromEntries(response.progress.map((p) => [p.featureId, p]));
    $('#sync-message').textContent = `GitHub PR 상태 조회 · ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    $('#sync-message').textContent = 'GitHub PR 상태 조회 실패';
    toast(error.message);
  } finally {
    state.fetching = false;
    $('#refresh-button').disabled = false;
    render();
  }
}

function addSlotRow(slot = {}) {
  const row = document.createElement('div');
  row.className = 'editor-row slot-row';
  row.dataset.slotId = slot.id || '';
  row.innerHTML = `<input class="row-input" data-field="label" maxlength="140" placeholder="PR01 — 기능명" aria-label="PR 제목" value="${esc(slot.label || '')}">
    <input class="row-input" data-field="repo" maxlength="160" placeholder="owner/repo" aria-label="GitHub 저장소" value="${esc(slot.repo || '')}">
    <input class="row-input" data-field="branch" maxlength="200" placeholder="브랜치 (선택)" aria-label="브랜치" value="${esc(slot.branch || '')}">
    <input class="row-input" data-field="number" type="number" min="1" placeholder="PR #" aria-label="PR 번호" value="${esc(slot.number ?? '')}">
    <button type="button" class="remove-row" data-remove-row aria-label="PR 행 삭제">×</button>`;
  $('#pr-editor-list').append(row);
}

function addCheckRow(check = {}) {
  const row = document.createElement('div');
  row.className = 'editor-row check-row';
  row.dataset.checkId = check.id || '';
  row.innerHTML = `<input class="row-input" data-field="text" maxlength="280" placeholder="예: 청구서 수정 후 다시 열어도 금액이 유지되는가?" aria-label="직접 확인할 내용" value="${esc(check.text || '')}"><button type="button" class="remove-row" data-remove-row aria-label="확인 항목 삭제">×</button>`;
  $('#check-editor-list').append(row);
}

function openEditor(feature = null) {
  state.editorId = feature?.id || null;
  $('#editor-title').textContent = feature ? '기능 수정' : '기능 등록';
  $('#editor-form').reset();
  $('#field-title').value = feature?.title || '';
  $('#field-product').value = feature?.product || 'Office';
  $('#field-summary').value = feature?.summary || '';
  $('#field-spec-url').value = feature?.specificationUrl || '';
  $('#field-spec').value = feature?.specification || '';
  $('#field-plan-url').value = feature?.developmentPlanUrl || '';
  $('#field-plan').value = feature?.developmentPlan || '';
  $('#pr-editor-list').replaceChildren();
  $('#check-editor-list').replaceChildren();
  if (feature) {
    feature.prSlots.forEach(addSlotRow);
    feature.checks.forEach(addCheckRow);
  } else {
    addSlotRow(); addCheckRow();
  }
  $('#editor-dialog').showModal();
  $('#field-title').focus();
}

function collectEditor() {
  const prSlots = $$('.slot-row').map((row) => ({
    ...(row.dataset.slotId ? { id: row.dataset.slotId } : {}),
    label: $('[data-field="label"]', row).value.trim(),
    repo: $('[data-field="repo"]', row).value.trim(),
    branch: $('[data-field="branch"]', row).value.trim(),
    number: $('[data-field="number"]', row).value.trim()
  })).filter((slot) => slot.label || slot.repo || slot.branch || slot.number);
  const checks = $$('.check-row').map((row) => ({
    ...(row.dataset.checkId ? { id: row.dataset.checkId } : {}),
    text: $('[data-field="text"]', row).value.trim()
  })).filter((check) => check.text);
  return {
    title: $('#field-title').value,
    product: $('#field-product').value,
    summary: $('#field-summary').value,
    specificationUrl: $('#field-spec-url').value,
    specification: $('#field-spec').value,
    developmentPlanUrl: $('#field-plan-url').value,
    developmentPlan: $('#field-plan').value,
    prSlots, checks
  };
}

async function saveEditor(event) {
  event.preventDefault();
  const button = $('#save-editor');
  button.disabled = true;
  try {
    const editing = state.editorId;
    const response = await api(editing ? `/api/features/${editing}` : '/api/features', {
      method: editing ? 'PATCH' : 'POST', body: collectEditor()
    });
    $('#editor-dialog').close();
    await loadFeatures(response.feature.id);
    toast(editing ? '기능 정보가 수정되었습니다.' : '새 기능을 등록했습니다.');
    await refreshProgress(true);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

async function loadFeatures(selectId = null) {
  const response = await api('/api/features');
  state.features = response.features;
  if (selectId) state.selectedId = selectId;
  if (!state.features.some((f) => f.id === state.selectedId)) state.selectedId = state.features[0]?.id || null;
  render();
}

async function updateCheck(checkId, result, note) {
  const id = state.selectedId;
  try {
    await api(`/api/features/${id}/checks/${checkId}`, { method: 'PATCH', body: { result, note } });
    await loadFeatures(id);
    toast('확인 결과를 저장했습니다.');
  } catch (error) { toast(error.message); }
}

async function deleteSelected() {
  const feature = state.features.find((item) => item.id === state.selectedId);
  if (!feature || !confirm(`'${feature.title}' 기능과 직접 확인 기록을 삭제할까요?\nGitHub 문서와 PR은 삭제되지 않습니다.`)) return;
  try {
    await api(`/api/features/${feature.id}`, { method: 'DELETE' });
    delete state.progress[feature.id];
    state.selectedId = null;
    await loadFeatures();
    toast('등록된 기능을 삭제했습니다.');
  } catch (error) { toast(error.message); }
}

async function init() {
  $('#create-button').addEventListener('click', () => openEditor());
  $('#refresh-button').addEventListener('click', () => refreshProgress(true));
  $('#feature-search').addEventListener('input', (event) => { state.search = event.target.value; renderList(); });
  $('#product-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (button) { state.filter = button.dataset.filter; renderFilters(); renderList(); }
  });
  $('#feature-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-feature-id]');
    if (button) selectFeature(button.dataset.featureId);
  });
  $('#detail').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const feature = state.features.find((item) => item.id === state.selectedId);
    if (!feature) return;
    const action = button.dataset.action;
    if (action === 'edit') return openEditor(feature);
    if (action === 'delete') return deleteSelected();
    if (action === 'toggle-document') {
      const key = button.dataset.document;
      state.preview[key] = !state.preview[key];
      return renderDetail();
    }
    if (action === 'set-check' || action === 'save-note') {
      const check = feature.checks.find((item) => item.id === button.dataset.checkId);
      if (!check) return;
      const note = $('.note-input', button.closest('[data-check-card]'))?.value || '';
      const result = action === 'set-check' ? button.dataset.result : check.result;
      return updateCheck(check.id, result, note);
    }
  });
  $('#editor-form').addEventListener('submit', saveEditor);
  $('#add-pr').addEventListener('click', () => addSlotRow());
  $('#add-check').addEventListener('click', () => addCheckRow());
  $('#editor-form').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-row]');
    if (remove) remove.closest('.editor-row').remove();
  });
  $('#close-editor').addEventListener('click', () => $('#editor-dialog').close());
  $('#cancel-editor').addEventListener('click', () => $('#editor-dialog').close());
  $('#editor-dialog').addEventListener('close', () => { state.editorId = null; });

  try {
    const health = await api('/api/health');
    state.githubConfigured = health.githubTokenConfigured;
    await loadFeatures();
    await refreshProgress();
    if (!state.githubConfigured) $('#sync-message').textContent += ' · 비공개 저장소는 .env에 GITHUB_TOKEN 필요';
  } catch (error) {
    toast(`초기 데이터 로드 실패: ${error.message}`);
  }
  setInterval(() => { if (!document.hidden) refreshProgress(); }, 120_000);
}

init();