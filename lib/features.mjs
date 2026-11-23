import { createHash } from 'node:crypto';

// One feature = one Markdown file written by GPT. Format (see features/_TEMPLATE.md):
//
// ---
// title: 기능 이름
// products: Office, Worker
// repo: owner/repo            (default repo for the steps)
// ---
// ## 기획
// free text
// ## 개발 계획
// - 단계 제목 | branch: feat/x | repo: owner/other | pr: 12
// ## 확인 항목
// - 어떤 화면에서 무엇을 눌러 확인할지

const REPO = /^[\w.-]+\/[\w.-]+$/;
const BRANCH = /^[\w./-]+$/;

export function isValidRepo(value) {
  return REPO.test(value);
}

export function isValidBranch(value) {
  return BRANCH.test(value) && !value.includes('..') && !value.endsWith('/') && value.length <= 200;
}

export function featureIdFromPath(path) {
  return path.split('/').pop().replace(/\.md$/i, '');
}

export function isFeatureFile(name) {
  return /\.md$/i.test(name) && !name.startsWith('_') && !name.startsWith('.') && name.toLowerCase() !== 'readme.md';
}

// Fixed sub-headings inside "## 기획". Folded ones stay closed in the UI.
export const PLAN_PARTS = [
  { key: 'who', label: '누구를 위해', match: /누구|대상|사용자/ },
  { key: 'why', label: '왜', match: /^왜|문제|배경/ },
  { key: 'outcome', label: '완성되면', match: /완성|달라지|할 수 있/ },
  { key: 'screens', label: '화면', match: /화면|메뉴/ },
  { key: 'rules', label: '지켜야 할 규칙', match: /규칙|원칙/, folded: true },
  { key: 'out', label: '이번에 안 하는 것', match: /안\s*하는|제외|범위\s*밖/, folded: true }
];

export function splitPlan(plan) {
  const sections = [];
  let currentSection = { key: 'intro', label: '', folded: false, lines: [] };
  for (const line of plan.split('\n')) {
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      sections.push(currentSection);
      const name = heading[1].trim();
      const part = PLAN_PARTS.find((p) => p.match.test(name.replace(/\s+/g, ' ')));
      currentSection = part
        ? { key: part.key, label: part.label, folded: Boolean(part.folded), lines: [] }
        : { key: 'other', label: name, folded: true, lines: [] };
      continue;
    }
    currentSection.lines.push(line);
  }
  sections.push(currentSection);
  return sections
    .map(({ lines, ...rest }) => ({ ...rest, text: lines.join('\n').trim() }))
    .filter((section) => section.text);
}

export function checkId(text) {
  return createHash('sha1').update(text.trim()).digest('hex').slice(0, 12);
}

function parseFrontMatter(lines) {
  const meta = {};
  if (lines[0]?.trim() !== '---') return { meta, rest: lines };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { meta, rest: lines };
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
    if (match) meta[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, rest: lines.slice(end + 1) };
}

function sectionKind(heading) {
  const name = heading.replace(/\s+/g, '');
  if (name.includes('개발') || /plan|step/i.test(name)) return 'steps';
  if (name.includes('확인') || name.includes('체크') || /check/i.test(name)) return 'checks';
  if (name.includes('기획') || /spec|intent/i.test(name)) return 'plan';
  return null;
}

function listItems(lines) {
  const items = [];
  for (const raw of lines) {
    const bullet = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (bullet) {
      if (bullet[1].trim()) items.push(bullet[1].trim());
    } else if (raw.trim() && items.length && /^\s{2,}/.test(raw)) {
      items[items.length - 1] += ` ${raw.trim()}`;
    }
  }
  return items;
}

function parseStep(item, index, defaultRepo, warnings) {
  const [titlePart, ...parts] = item.split('|').map((part) => part.trim());
  const step = { index: index + 1, title: titlePart.replace(/^step\s*\d+\s*[—:-]?\s*/i, '') || `Step ${index + 1}`, repo: defaultRepo, branch: '', number: null };
  for (const part of parts) {
    if (!part) continue;
    const keyed = part.match(/^(branch|브랜치|repo|저장소|pr)\s*:\s*(.+)$/i);
    const key = keyed ? keyed[1].toLowerCase() : (/^#\d+$/.test(part) ? 'pr' : 'branch');
    const value = (keyed ? keyed[2] : part).trim();
    if (key === 'pr') {
      const number = Number(value.replace(/^#/, ''));
      if (Number.isSafeInteger(number) && number > 0) step.number = number;
      else warnings.push(`Step ${index + 1}: PR 번호 "${value}"를 읽을 수 없습니다.`);
    } else if (key === 'repo' || key === '저장소') {
      if (isValidRepo(value)) step.repo = value;
      else warnings.push(`Step ${index + 1}: 저장소 "${value}"는 owner/repo 형식이 아닙니다.`);
    } else if (isValidBranch(value)) {
      step.branch = value;
    } else {
      warnings.push(`Step ${index + 1}: 브랜치 "${value}"를 읽을 수 없습니다.`);
    }
  }
  if ((step.branch || step.number) && !step.repo) {
    warnings.push(`Step ${index + 1}: 저장소가 없어 PR을 찾을 수 없습니다. (repo: owner/repo)`);
  }
  return step;
}

export function parseFeatureDoc(id, text) {
  const warnings = [];
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const { meta, rest } = parseFrontMatter(lines);
  const sections = { plan: [], steps: [], checks: [] };
  let current = null;
  let firstHeading = '';
  for (const line of rest) {
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1 && !firstHeading) { firstHeading = h1[1].trim(); continue; }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    // "###" inside 기획 are its sub-headings, never a switch to another section.
    if (heading && !(current === 'plan' && heading[1] === '###')) {
      const kind = sectionKind(heading[2]);
      if (kind) { current = kind; continue; }
      // A sub-heading inside 기획 stays part of the free text.
      if (current !== 'plan') { current = null; continue; }
    }
    if (current) sections[current].push(line);
  }

  let defaultRepo = meta.repo || '';
  if (defaultRepo && !isValidRepo(defaultRepo)) {
    warnings.push(`기본 저장소 "${defaultRepo}"는 owner/repo 형식이 아닙니다.`);
    defaultRepo = '';
  }
  const products = (meta.products || meta.product || '')
    .replace(/^\[|\]$/g, '')
    .split(/[,/]/)
    .map((p) => p.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  const seen = new Map();
  const checks = listItems(sections.checks).map((textItem) => {
    const base = checkId(textItem);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return { id: count ? `${base}-${count}` : base, text: textItem };
  });

  const plan = sections.plan.join('\n').trim();
  return {
    id,
    title: meta.title || firstHeading || id,
    products: [...new Set(products)],
    repo: defaultRepo,
    plan,
    planSections: splitPlan(plan),
    steps: listItems(sections.steps).map((item, index) => parseStep(item, index, defaultRepo, warnings)),
    checks,
    updated: meta.updated || meta.date || '',
    warnings
  };
}
