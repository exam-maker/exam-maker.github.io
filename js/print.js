// js/print.js
// 출력 탭: 저장된 세트를 골라 문제지, 정답표, 해설을 인쇄하거나 PDF로 저장합니다. 로고는 위치·정렬·크기(%) 설정을 따릅니다.

import { getAll, getItem, getSettings } from './db.js';
import { typeLabel } from './schema.js';
import { logoWidthPx, normalizeLogoSettings } from './logo.js';

const ALIGNS = ['left', 'center', 'right'];

const STYLE = `
.pr-card { border: 1px solid #e3e6ea; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.pr-card h3 { margin-top: 0; font-size: 17px; }
.pr-field { display: block; margin-bottom: 12px; }
.pr-field > span { display: block; font-size: 14px; font-weight: bold; margin-bottom: 4px; }
.pr-field select { width: 100%; padding: 8px; border: 1px solid #bbb; border-radius: 6px; font-size: 14px; }
.pr-opts { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 12px; font-size: 14px; }
.pr-btn { padding: 8px 14px; border: 1px solid #000; background: #000; color: #fff; border-radius: 6px; cursor: pointer; font-size: 14px; }
.pr-hint { color: #666; font-size: 13px; }
.pr-sheet { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 32px; max-width: 800px; margin: 0 auto 16px; color: #000; }
.pr-head { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 20px; }
.pr-head h2 { margin: 4px 0; font-size: 20px; }
.pr-head p { margin: 2px 0; font-size: 13px; color: #333; }
.pr-brand { margin-bottom: 8px; }
.pr-brand img { display: inline-block; max-width: 100%; margin-bottom: 4px; }
.pr-brand p { margin: 2px 0; font-size: 13px; color: #333; }
.pr-foot { margin-top: 24px; border-top: 1px solid #999; padding-top: 12px; }
.pr-passage { border: 1px solid #999; padding: 12px; margin-bottom: 20px; }
.pr-passage h4 { margin: 0 0 8px; font-size: 15px; }
.pr-pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.7; margin: 0; }
.pr-item { margin-bottom: 18px; font-size: 14px; line-height: 1.6; }
.pr-q { margin: 0 0 6px; white-space: pre-wrap; }
.pr-tag { font-size: 12px; color: #555; }
.pr-body { white-space: pre-wrap; font-family: inherit; background: #f7f7f7; padding: 8px; margin: 6px 0; }
.pr-choice { margin: 2px 0 2px 12px; }
.pr-lines { border-bottom: 1px solid #999; height: 26px; margin: 6px 0; }
.pr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pr-table th, .pr-table td { border: 1px solid #999; padding: 6px; text-align: center; }
.pr-section-title { font-size: 16px; font-weight: bold; margin: 0 0 12px; }
.pr-explain { font-size: 13px; margin-bottom: 10px; white-space: pre-wrap; }
@page { size: A4; margin: 15mm; }
@media print {
  body.pr-printing .app-header,
  body.pr-printing .tab-bar,
  body.pr-printing .app-footer,
  body.pr-printing .pr-controls { display: none !important; }
  body.pr-printing .tab-panel:not([data-panel="print"]) { display: none !important; }
  body.pr-printing .pr-sheet { border: none; padding: 0; margin: 0; max-width: none; }
  body.pr-printing .pr-item, body.pr-printing .pr-explain { break-inside: avoid; }
  body.pr-printing .pr-page-break { break-before: page; }
}
`;

let panel = null;
let currentSet = null;

/** HTML에 넣을 글자를 안전하게 바꿉니다. */
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 버튼 동작 중 오류가 나면 화면에 알려 줍니다. */
function safe(fn, ...args) {
  return Promise.resolve()
    .then(() => fn(...args))
    .catch((err) => {
      console.error(err);
      alert(err.message || '오류가 발생했습니다.');
    });
}

/** 탭 전체 골격을 그립니다. */
function renderShell() {
  panel.innerHTML = `
    <section class="pr-card pr-controls">
      <h3>1. 출력할 세트</h3>
      <label class="pr-field">
        <span>세트 (변형문제 생성 탭에서 저장한 세트)</span>
        <select id="pr-set"></select>
      </label>
      <div class="pr-opts">
        <label><input type="checkbox" id="pr-opt-passage" checked> 지문 포함</label>
        <label><input type="checkbox" id="pr-opt-answer" checked> 정답표 포함</label>
        <label><input type="checkbox" id="pr-opt-explain"> 해설 포함</label>
      </div>
      <p class="pr-hint">로고 위치, 정렬, 크기는 설정 탭에서 바꿀 수 있습니다.</p>
      <button class="pr-btn" data-action="print">인쇄하기</button>
      <p class="pr-hint">인쇄 창에서 대상을 "PDF로 저장"으로 고르면 파일로도 남길 수 있습니다. 용지는 A4 기준입니다.</p>
    </section>
    <div id="pr-sheet" class="pr-sheet"></div>
  `;
}

/** 저장된 세트를 선택 상자에 채웁니다. */
async function renderOptions() {
  const sel = document.getElementById('pr-set');
  const sets = (await getAll('sets'))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  sel.innerHTML = sets.length
    ? '<option value="">세트를 고르세요</option>' +
      sets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${(s.items || []).length}문항)</option>`).join('')
    : '<option value="">저장된 세트가 없습니다</option>';
}

/** 체크박스 상태를 읽습니다. */
function readOptions() {
  return {
    passage: document.getElementById('pr-opt-passage').checked,
    answer: document.getElementById('pr-opt-answer').checked,
    explain: document.getElementById('pr-opt-explain').checked,
  };
}

/** 로고와 학원명을 한 묶음으로 만듭니다. 정렬과 크기(%)는 설정값을 따릅니다. */
function brandHtml(settings) {
  const s = normalizeLogoSettings(settings);
  const align = ALIGNS.includes(s.logoAlign) ? s.logoAlign : 'center';
  const px = logoWidthPx(s);
  const img = s.logo
    ? `<img src="${esc(s.logo)}" alt="로고" style="width:${px}px;">`
    : '';
  const name = s.academyName ? `<p>${esc(s.academyName)}</p>` : '';
  if (!img && !name) return '';
  return `<div class="pr-brand" style="text-align:${align};">${img}${name}</div>`;
}

/** 세트 한 개를 문제지 HTML로 만듭니다. */
function sheetHtml(rec, settings, opt) {
  const s = normalizeLogoSettings(settings);
  const items = rec.items || [];
  const title = String(rec.blueprintLabel || rec.name || '').replace(/\s*\(\d+문항\)$/, '');
  const position = s.logoPosition === 'bottom' ? 'bottom' : 'top';

  const topBrand = position === 'top' ? brandHtml(s) : '';
  const bottomBrand = position === 'bottom' ? brandHtml(s) : '';

  const head = `
    <div class="pr-head">
      ${topBrand}
      <h2>${esc(title)} 변형 문제</h2>
    </div>`;

  const passage = opt.passage && rec.passage
    ? `<section class="pr-passage">
         <h4>${esc(rec.passage.title)}</h4>
         <p class="pr-pre">${esc(rec.passage.text)}</p>
       </section>`
    : '';

  const questions = items.map((it, i) => {
    const choices = Array.isArray(it.choices) && it.choices.length
      ? it.choices.map((c) => `<p class="pr-choice">${esc(c)}</p>`).join('')
      : '';
    const lines = it.format === 'WR'
      ? '<div class="pr-lines"></div><div class="pr-lines"></div>'
      : '';
    return `
      <div class="pr-item">
        <p class="pr-q"><b>${i + 1}.</b> ${esc(it.stem)} <span class="pr-tag">[${esc(typeLabel(it.type))}]</span></p>
        ${it.body ? `<pre class="pr-body">${esc(it.body)}</pre>` : ''}
        ${choices}
        ${lines}
      </div>`;
  }).join('');

  let answerSection = '';
  if (opt.answer || opt.explain) {
    const table = opt.answer
      ? `<table class="pr-table">
           <tr><th>번호</th>${items.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr>
           <tr><th>정답</th>${items.map((it) => `<td>${esc(it.answer)}</td>`).join('')}</tr>
         </table>`
      : '';
    const explains = opt.explain
      ? items.map((it, i) => `<p class="pr-explain"><b>${i + 1}번</b> ${esc(it.explanation)}</p>`).join('')
      : '';
    answerSection = `
      <div class="pr-page-break">
        <p class="pr-section-title">${opt.answer ? '정답' : ''}${opt.answer && opt.explain ? ' 및 ' : ''}${opt.explain ? '해설' : ''}</p>
        ${table}
        ${explains ? `<div style="margin-top:12px">${explains}</div>` : ''}
      </div>`;
  }

  const foot = bottomBrand ? `<div class="pr-foot">${bottomBrand}</div>` : '';

  return `${head}${passage}${questions}${answerSection}${foot}`;
}

/** 미리보기 영역을 현재 세트와 옵션에 맞춰 다시 그립니다. */
async function renderSheet() {
  const box = document.getElementById('pr-sheet');
  if (!currentSet) {
    box.innerHTML = '<p class="pr-hint">출력할 세트를 고르세요. 세트가 없다면 변형문제 생성 탭에서 먼저 저장하세요.</p>';
    return;
  }
  // 설정이 없을 때를 대비해 빈 객체를 쓰고, 이전 버전 값도 % 기준으로 정리합니다.
  const settings = normalizeLogoSettings((await getSettings()) || {});
  box.innerHTML = sheetHtml(currentSet, settings, readOptions());
}

/** 세트 선택이 바뀌면 그 세트를 불러옵니다. */
async function onSetChange(id) {
  currentSet = id ? await getItem('sets', id) : null;
  await renderSheet();
}

/** 인쇄 창을 엽니다. 인쇄가 끝나면 메뉴와 탭을 다시 보여 줍니다. */
async function onPrint() {
  if (!currentSet) return alert('세트를 고르세요.');
  await renderSheet();

  document.body.classList.add('pr-printing');
  const cleanup = () => {
    document.body.classList.remove('pr-printing');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'print') return safe(onPrint);
}

function onChange(e) {
  const el = e.target;
  if (el.id === 'pr-set') return safe(onSetChange, el.value);
  if (el.id.startsWith('pr-opt-')) return safe(renderSheet);
}

/** 출력 탭을 시작합니다. main.js가 호출합니다. */
export async function initPrint() {
  panel = document.getElementById('tab-print');
  if (!panel) return;

  if (!document.getElementById('print-style')) {
    const style = document.createElement('style');
    style.id = 'print-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  renderShell();
  panel.addEventListener('click', onClick);
  panel.addEventListener('change', onChange);
  await renderOptions();
  await renderSheet();
}
