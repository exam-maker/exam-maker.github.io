// js/analyze.js
// 기출 분석 탭: 시험지 입력, AI 분석, 카드 표 수정, 요약, 설계도 저장·불러오기·복제·삭제를 담당합니다.
// 원본 시험지 파일과 기출 원문(originalText)은 저장하지 않습니다.

import { callAIJson, fileToBase64, AIError } from './ai.js';
import { buildAnalysisPrompt } from './prompts.js';
import {
  TYPES, TYPE_MAP, GRADES, EXAM_NAMES, SOURCES,
  normalizeCard, validateCard, validateBlueprint, buildSummary,
} from './schema.js';
import { getAll, getItem, putItem, deleteItem } from './db.js';
import { autoSaveBlueprint } from './autosave.js';

const FILE_MAX_BYTES = 20 * 1024 * 1024;   // 파일 한 개의 최대 크기
const TOTAL_WARN_BYTES = 15 * 1024 * 1024; // 합계가 이보다 크면 나눠서 분석하라고 안내
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const REFRESH_FIELDS = ['no', 'format', 'type', 'difficulty', 'source'];

const STYLE = `
.an-card { border: 1px solid #e3e6ea; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.an-card h3 { margin-top: 0; font-size: 17px; }
.an-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 720px) { .an-grid4 { grid-template-columns: 1fr 1fr; } }
.an-field { display: block; margin-bottom: 12px; }
.an-field > span { display: block; font-size: 14px; font-weight: bold; margin-bottom: 4px; }
.an-field input, .an-field select, .an-field textarea { width: 100%; padding: 8px; border: 1px solid #bbb; border-radius: 6px; font-size: 14px; }
.an-btn { padding: 8px 14px; border: 1px solid #000; background: #000; color: #fff; border-radius: 6px; cursor: pointer; margin: 4px 6px 4px 0; font-size: 14px; }
.an-btn:disabled { background: #aaa; border-color: #aaa; cursor: not-allowed; }
.an-light { background: #fff; color: #000; }
.an-danger { background: #fff; color: #c62828; border-color: #c62828; }
.an-small { padding: 4px 8px; font-size: 12px; }
.an-hint { color: #666; font-size: 13px; }
.an-status { font-size: 14px; font-weight: bold; margin-left: 8px; }
.an-warn { background: #fff7e0; border: 1px solid #f5a623; padding: 8px; border-radius: 6px; font-size: 13px; margin: 8px 0; }
.an-scroll { overflow-x: auto; }
.an-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.an-table th, .an-table td { border: 1px solid #ddd; padding: 4px; vertical-align: top; }
.an-table th { background: #f4f6f8; white-space: nowrap; }
.an-table input, .an-table select, .an-table textarea { width: 100%; font-size: 12px; padding: 3px; }
.an-row-error td { background: #fdecea; }
.an-err { color: #c62828; font-weight: bold; }
.an-ok { color: #2e7d32; }
.an-bar-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 13px; }
.an-bar-label { width: 180px; }
.an-bar-track { flex: 1; background: #eee; height: 14px; border-radius: 7px; overflow: hidden; }
.an-bar-fill { background: #000; height: 100%; }
.an-bar-num { width: 90px; text-align: right; }
.an-raw { white-space: pre-wrap; background: #f7f7f7; padding: 8px; font-size: 12px; max-height: 300px; overflow: auto; }
.an-file-list { font-size: 13px; color: #444; margin-bottom: 8px; }
`;

let panel = null;
let pendingFiles = [];
let state = emptyState();

function emptyState() {
  return {
    id: null,
    createdAt: null,
    meta: { school: '', grade: '고1', exam: '1학기 중간', year: new Date().getFullYear() },
    cards: [],
    trendNote: '',
  };
}

/** HTML에 넣을 글자를 안전하게 바꿉니다. */
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 기출 원문(originalText)을 빈 값으로 바꾼 카드를 돌려줍니다. 저장 전에 항상 거칩니다. */
function stripOriginal(card) {
  return { ...card, originalText: '' };
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

/** 탭 전체 골격과 입력 칸을 그립니다. */
function renderShell() {
  panel.innerHTML = `
    <h2>기출 분석</h2>

    <section class="an-card">
      <h3>1. 시험지 정보</h3>
      <div class="an-grid4">
        <label class="an-field"><span>학교</span>
          <input id="an-school" maxlength="40" placeholder="예: OO고등학교"></label>
        <label class="an-field"><span>학년</span>
          <select id="an-grade">${GRADES.map((g) => `<option value="${g}">${g}</option>`).join('')}</select></label>
        <label class="an-field"><span>시험</span>
          <select id="an-exam">${EXAM_NAMES.map((e) => `<option value="${e}">${e}</option>`).join('')}</select></label>
        <label class="an-field"><span>연도</span>
          <input id="an-year" type="number" min="2000" max="2100"></label>
      </div>
    </section>

    <section class="an-card">
      <h3>2. 기출 자료</h3>
      <label class="an-field">
        <span>파일 업로드 (PDF, PNG, JPG, 여러 개 가능, 파일당 20MB 이하)</span>
        <input id="an-files" type="file" accept="application/pdf,image/png,image/jpeg" multiple>
      </label>
      <div id="an-file-list" class="an-file-list"></div>
      <label class="an-field">
        <span>또는 텍스트 붙여넣기</span>
        <textarea id="an-text" rows="6" placeholder="시험지 내용을 그대로 붙여넣어도 됩니다."></textarea>
      </label>
      <p class="an-hint">원본 시험지 파일은 저장되지 않습니다. 분석이 끝나면 입력 칸이 자동으로 비워집니다. 파일이 여러 개이거나 용량이 크면 한 번에 읽지 못할 수 있으니, 그럴 때는 시험지를 나눠서 분석하세요. 무료 등급 Gemini를 쓰면 입력 내용이 구글 학습에 쓰일 수 있습니다.</p>
      <button class="an-btn" data-action="analyze" id="an-run">유형 분석</button>
      <span id="an-status" class="an-status"></span>
    </section>

    <div id="an-result"></div>

    <section class="an-card">
      <h3>저장된 설계도</h3>
      <div id="an-list"></div>
    </section>
  `;
  setMetaInputs(state.meta);
}

/** 학교, 학년, 시험, 연도 칸에 값을 넣습니다. */
function setMetaInputs(meta) {
  document.getElementById('an-school').value = meta.school || '';
  document.getElementById('an-grade').value = meta.grade;
  document.getElementById('an-exam').value = meta.exam;
  document.getElementById('an-year').value = meta.year;
}

/** 학교, 학년, 시험, 연도 칸의 현재 값을 읽습니다. */
function readMeta() {
  return {
    school: document.getElementById('an-school').value.trim(),
    grade: document.getElementById('an-grade').value,
    exam: document.getElementById('an-exam').value,
    year: Number(document.getElementById('an-year').value),
  };
}

/** 파일 선택 칸, 파일 목록, 텍스트 칸을 비웁니다. 분석 성공 후에 씁니다. */
function clearInputs() {
  pendingFiles = [];
  document.getElementById('an-files').value = '';
  document.getElementById('an-file-list').textContent = '';
  document.getElementById('an-text').value = '';
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

/** 파일을 고르면 목록과 합계 용량을 보여 줍니다. */
function onFilesChange(input) {
  pendingFiles = [...input.files];
  const box = document.getElementById('an-file-list');
  if (pendingFiles.length === 0) {
    box.textContent = '';
    return;
  }
  const total = pendingFiles.reduce((sum, f) => sum + f.size, 0);
  box.innerHTML =
    pendingFiles.map((f) => `${esc(f.name)} (${mb(f.size)}MB)`).join('<br>') +
    `<br>합계 ${mb(total)}MB`;
}

/** 유형 분석 버튼: 파일 또는 텍스트를 AI에 보내고 카드 목록을 받습니다. */
async function onAnalyze() {
  const meta = readMeta();
  const text = document.getElementById('an-text').value.trim();
  const status = document.getElementById('an-status');
  const btn = document.getElementById('an-run');

  if (!meta.school) return alert('학교명을 입력하세요.');
  if (!Number.isInteger(meta.year) || meta.year < 2000 || meta.year > 2100) {
    return alert('연도를 올바르게 입력하세요.');
  }
  if (pendingFiles.length === 0 && !text) {
    return alert('파일을 올리거나 텍스트를 붙여넣으세요.');
  }

  const badType = pendingFiles.find((f) => !ALLOWED_TYPES.includes(f.type));
  if (badType) return alert(`PDF, PNG, JPG 파일만 올릴 수 있습니다: ${badType.name}`);

  const bigFile = pendingFiles.find((f) => f.size > FILE_MAX_BYTES);
  if (bigFile) return alert(`파일이 너무 큽니다(20MB 이하만 가능): ${bigFile.name}`);

  const total = pendingFiles.reduce((sum, f) => sum + f.size, 0);
  if (total >= TOTAL_WARN_BYTES && !confirm('자료 합계가 커서 요청이 실패할 수 있습니다. 그래도 진행할까요?')) {
    return;
  }

  btn.disabled = true;
  status.textContent = '분석 중입니다. 자료 양에 따라 1~2분 걸릴 수 있습니다...';

  try {
    const encoded = await Promise.all(pendingFiles.map(fileToBase64));
    const prompt = buildAnalysisPrompt(meta);
    const userText = text
      ? `${prompt.userText}\n\n[시험지 텍스트]\n${text}`
      : prompt.userText;

    const result = await callAIJson({
      stage: 'analyze',
      system: prompt.system,
      userText,
      files: encoded,
    });

    if (!Array.isArray(result?.cards) || result.cards.length === 0) {
      throw new AIError('AI가 문항을 찾지 못했습니다. 자료를 확인한 뒤 다시 시도하세요.');
    }

    state = {
      id: null,
      createdAt: null,
      meta,
      cards: result.cards.map((c) => normalizeCard(stripOriginal(c))),
      trendNote: result.summary?.trendNote || '',
    };
    clearInputs();
    status.textContent = `분석 완료: ${state.cards.length}개 문항 (원본 파일은 저장하지 않아 입력 칸을 비웠습니다)`;
    renderResult();
    document.getElementById('an-result').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    status.textContent = '';
    showError(err);
  } finally {
    btn.disabled = false;
  }
}

/** 오류 메시지를 띄우고, AI 원문이 있으면 결과 영역에 보여 줍니다. 화면에만 표시하며 저장하지 않습니다. */
function showError(err) {
  alert(err.message || '알 수 없는 오류가 발생했습니다.');
  if (err.raw) {
    document.getElementById('an-result').innerHTML = `
      <section class="an-card">
        <h3>AI 원문</h3>
        <p class="an-hint">JSON으로 읽지 못한 원문입니다. 내용을 확인하거나 다시 분석해 보세요.</p>
        <pre class="an-raw">${esc(err.raw)}</pre>
      </section>`;
  }
}

/** 카드 표, 요약, 저장 영역을 그립니다. 카드가 없으면 비웁니다. */
function renderResult() {
  const box = document.getElementById('an-result');
  if (state.cards.length === 0) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = `
    <section class="an-card">
      <h3>3. 유형 카드 (직접 수정 가능)</h3>
      <p class="an-hint">표의 값은 바로 고칠 수 있습니다. 붉은 행은 저장 전에 고쳐야 할 항목입니다. 기출 원문은 저장하지 않으므로 표에 나타나지 않습니다.</p>
      <div class="an-scroll">
        <table class="an-table">
          <thead>
            <tr>
              <th>번호</th><th>형식</th><th>유형</th><th>발문 패턴</th><th>핵심 포인트</th>
              <th>난이도</th><th>배점</th><th>출처</th><th>선택지 수</th><th>메모</th>
              <th>검사 / 삭제</th>
            </tr>
          </thead>
          <tbody id="an-tbody"></tbody>
        </table>
      </div>
      <button class="an-btn an-light" data-action="add-row">행 추가</button>
    </section>

    <section class="an-card">
      <h3>4. 요약</h3>
      <div id="an-summary"></div>
    </section>

    <section class="an-card">
      <h3>5. 설계도 저장</h3>
      <label class="an-field">
        <span>경향 메모</span>
        <textarea id="an-trend" rows="3"></textarea>
      </label>
      <button class="an-btn" data-action="save">설계도로 저장</button>
      <span id="an-save-msg" class="an-hint"></span>
    </section>
  `;

  document.getElementById('an-trend').value = state.trendNote;
  renderTable();
  renderSummary();
}

/** <select> 한 개를 만듭니다. */
function selectHtml(field, idx, options, selected) {
  return `<select data-field="${field}" data-idx="${idx}">${options
    .map(([value, label]) =>
      `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`)
    .join('')}</select>`;
}

/** 카드 한 줄의 HTML을 만듭니다. */
function rowHtml(card, i) {
  const errors = validateCard(card);
  const typeOptions = TYPES.map((t) => [t.code, `${t.code} ${t.name}`]);
  const difficultyOptions = [1, 2, 3, 4, 5].map((n) => [n, String(n)]);
  const formatOptions = [['MC', '객관식'], ['WR', '서술형']];
  const sourceOptions = SOURCES.map((s) => [s, s]);

  return `
    <tr class="${errors.length ? 'an-row-error' : ''}" title="${esc(errors.join(' / '))}">
      <td><input type="number" min="1" data-field="no" data-idx="${i}" value="${esc(card.no ?? '')}"></td>
      <td>${selectHtml('format', i, formatOptions, card.format)}</td>
      <td>${selectHtml('type', i, typeOptions, card.type)}</td>
      <td><input data-field="stemPattern" data-idx="${i}" value="${esc(card.stemPattern)}"></td>
      <td><input data-field="point" data-idx="${i}" value="${esc(card.point)}"></td>
      <td>${selectHtml('difficulty', i, difficultyOptions, card.difficulty)}</td>
      <td><input type="number" min="0" step="0.5" data-field="score" data-idx="${i}" value="${esc(card.score ?? '')}"></td>
      <td>${selectHtml('source', i, sourceOptions, card.source)}</td>
      <td><input type="number" min="0" data-field="choices" data-idx="${i}" value="${esc(card.choices ?? '')}"></td>
      <td><input data-field="note" data-idx="${i}" value="${esc(card.note)}"></td>
      <td>
        ${errors.length ? `<span class="an-err">오류 ${errors.length}</span>` : '<span class="an-ok">정상</span>'}
        <br>
        <button class="an-btn an-danger an-small" data-action="del-row" data-idx="${i}">삭제</button>
      </td>
    </tr>`;
}

function renderTable() {
  const tbody = document.getElementById('an-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.cards.map((card, i) => rowHtml(card, i)).join('');
}

/** 유형 비율 막대와 요약 숫자를 그립니다. */
function renderSummary() {
  const box = document.getElementById('an-summary');
  if (!box) return;

  const s = buildSummary(state.cards);
  const bars = TYPES
    .filter((t) => s.typeRatio[t.code])
    .map((t) => {
      const n = s.typeRatio[t.code];
      const pct = Math.round((n / s.totalItems) * 100);
      return `
        <div class="an-bar-row">
          <span class="an-bar-label">${t.code} ${esc(t.name)}</span>
          <div class="an-bar-track"><div class="an-bar-fill" style="width:${pct}%"></div></div>
          <span class="an-bar-num">${n}개 (${pct}%)</span>
        </div>`;
    })
    .join('');

  box.innerHTML = `
    <p>총 ${s.totalItems}문항 · 객관식 ${s.mcCount}개 · 서술형 ${s.wrCount}개 · 평균 난이도 ${s.avgDifficulty}</p>
    ${bars}`;
}

/** 표의 입력이 바뀌면 카드 데이터에 반영합니다. */
function onFieldChange(el, isChange) {
  const i = Number(el.dataset.idx);
  const field = el.dataset.field;
  const card = state.cards[i];
  if (!card) return;

  let value = el.value;
  if (['no', 'difficulty', 'choices'].includes(field)) {
    value = value === '' ? null : parseInt(value, 10);
  } else if (field === 'score') {
    value = value === '' ? null : parseFloat(value);
  }
  card[field] = value;

  if (!isChange) return;

  // 유형에 형식이 정해져 있으면(예: GRAMMAR는 객관식) 형식을 자동으로 맞춥니다.
  if (field === 'type' && TYPE_MAP[value] && TYPE_MAP[value].format) {
    card.format = TYPE_MAP[value].format;
  }
  if (REFRESH_FIELDS.includes(field)) {
    renderTable();
    renderSummary();
  }
}

function onAddRow() {
  const max = state.cards.reduce((m, c) => Math.max(m, c.no || 0), 0);
  state.cards.push(normalizeCard({
    no: max + 1,
    format: 'MC',
    type: 'GRAMMAR',
    stemPattern: '',
    point: '',
    difficulty: 3,
    score: null,
    source: 'UNKNOWN',
    choices: 5,
    visual: '',
    note: '',
    originalText: '',
  }));
  renderTable();
  renderSummary();
}

function onDeleteRow(i) {
  if (!confirm(`문항 행 ${i + 1}을(를) 삭제할까요?`)) return;
  state.cards.splice(i, 1);
  renderTable();
  renderSummary();
}

/** 설계도로 저장합니다. 검사에 걸리면 저장하지 않고 이유를 보여 줍니다. */
async function onSave() {
  const meta = readMeta();
  const msg = document.getElementById('an-save-msg');
  state.trendNote = document.getElementById('an-trend').value.trim();

  // 저장 직전에 기출 원문을 한 번 더 비웁니다.
  const cards = state.cards.map(stripOriginal);

  const bp = {
    id: state.id || undefined,
    createdAt: state.createdAt || new Date().toISOString(),
    school: meta.school,
    grade: meta.grade,
    exam: meta.exam,
    year: meta.year,
    cards,
    summary: { ...buildSummary(cards), trendNote: state.trendNote },
  };

  const errors = validateBlueprint(bp);
  if (errors.length > 0) {
    const shown = errors.slice(0, 6).join('\n');
    const more = errors.length > 6 ? `\n외 ${errors.length - 6}건` : '';
    return alert(`저장할 수 없습니다. 아래 항목을 고쳐 주세요.\n\n${shown}${more}`);
  }

  await putItem('blueprints', bp); // 새 설계도면 id가 자동으로 만들어집니다.
  state.id = bp.id;
  state.createdAt = bp.createdAt;
  state.cards = cards;

  // 연결된 저장 폴더에도 JSON 파일을 만듭니다. 실패해도 위의 브라우저 저장은 유지됩니다.
  let folderMsg = '';
  try {
    const fileName = await autoSaveBlueprint(bp);
    folderMsg = ` 다운로드 폴더에 저장했습니다: ${fileName}`;
  } catch (err) {
    console.warn('파일 저장 실패:', err);
    folderMsg = ' (파일 저장에 실패했습니다. 콘솔의 안내를 확인하세요.)';
  }

  msg.textContent = `저장되었습니다.${folderMsg}`;
  await renderList();
}

/** 저장된 설계도 목록을 그립니다. */
async function renderList() {
  const box = document.getElementById('an-list');
  const items = (await getAll('blueprints'))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  if (items.length === 0) {
    box.innerHTML = '<p class="an-hint">저장된 설계도가 없습니다.</p>';
    return;
  }

  box.innerHTML = `
    <div class="an-scroll">
      <table class="an-table">
        <thead>
          <tr><th>학교</th><th>학년</th><th>시험</th><th>문항 수</th><th>저장일</th><th>관리</th></tr>
        </thead>
        <tbody>
          ${items.map((bp) => `
            <tr>
              <td>${esc(bp.school)}</td>
              <td>${esc(bp.grade)}</td>
              <td>${esc(bp.year)} ${esc(bp.exam)}</td>
              <td>${(bp.cards || []).length}</td>
              <td>${esc((bp.createdAt || '').slice(0, 10))}</td>
              <td>
                <button class="an-btn an-light an-small" data-action="load" data-id="${esc(bp.id)}">불러오기</button>
                <button class="an-btn an-light an-small" data-action="dup" data-id="${esc(bp.id)}">복제</button>
                <button class="an-btn an-danger an-small" data-action="del" data-id="${esc(bp.id)}">삭제</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** 저장된 설계도를 화면에 불러옵니다. 저장하면 같은 설계도를 덮어씁니다. */
async function onLoad(id) {
  const bp = await getItem('blueprints', id);
  if (!bp) return alert('설계도를 찾을 수 없습니다.');

  state = {
    id: bp.id,
    createdAt: bp.createdAt,
    meta: { school: bp.school, grade: bp.grade, exam: bp.exam, year: bp.year },
    cards: (bp.cards || []).map((c) => normalizeCard(stripOriginal(c))),
    trendNote: bp.summary?.trendNote || '',
  };
  setMetaInputs(state.meta);
  renderResult();
  document.getElementById('an-result').scrollIntoView({ behavior: 'smooth' });
}

/** 설계도를 새 id로 복사합니다. 원본은 그대로 둡니다. */
async function onDuplicate(id) {
  const bp = await getItem('blueprints', id);
  if (!bp) return alert('설계도를 찾을 수 없습니다.');

  const copy = {
    ...bp,
    id: crypto.randomUUID(),
    school: `${bp.school} (복제)`,
    createdAt: new Date().toISOString(),
    cards: (bp.cards || []).map((c) => stripOriginal(JSON.parse(JSON.stringify(c)))),
  };
  await putItem('blueprints', copy);
  await renderList();
}

async function onDelete(id) {
  if (!confirm('이 설계도를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
  await deleteItem('blueprints', id);
  if (state.id === id) state.id = null;
  await renderList();
}

/**
 * 이전 버전에서 저장된 설계도에 남아 있는 기출 원문을 지웁니다.
 * 탭을 열 때 한 번 실행됩니다. 이미 깨끗한 설계도는 건드리지 않습니다.
 */
async function removeLegacyOriginals() {
  const items = await getAll('blueprints');
  for (const bp of items) {
    const hasOriginal = (bp.cards || []).some((c) => c.originalText);
    if (!hasOriginal) continue;
    await putItem('blueprints', {
      ...bp,
      cards: bp.cards.map((c) => stripOriginal(c)),
    });
  }
}

/** 탭 안의 버튼 클릭을 한 곳에서 처리합니다. */
function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  const idx = Number(btn.dataset.idx);

  if (action === 'analyze') return safe(onAnalyze);
  if (action === 'add-row') return onAddRow();
  if (action === 'del-row') return onDeleteRow(idx);
  if (action === 'save') return safe(onSave);
  if (action === 'load') return safe(onLoad, id);
  if (action === 'dup') return safe(onDuplicate, id);
  if (action === 'del') return safe(onDelete, id);
}

function onChange(e) {
  const el = e.target;
  if (el.id === 'an-files') return onFilesChange(el);
  if (el.dataset.field) return onFieldChange(el, true);
}

function onInput(e) {
  const el = e.target;
  if (el.id === 'an-trend') {
    state.trendNote = el.value;
    return;
  }
  if (el.dataset.field) onFieldChange(el, false);
}

/** 기출 분석 탭을 시작합니다. main.js가 호출합니다. */
export async function initAnalyze() {
  panel = document.getElementById('tab-analyze');
  if (!panel) return;

  if (!document.getElementById('analyze-style')) {
    const style = document.createElement('style');
    style.id = 'analyze-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  renderShell();
  panel.addEventListener('click', onClick);
  panel.addEventListener('change', onChange);
  panel.addEventListener('input', onInput);

  try {
    await removeLegacyOriginals();
  } catch (err) {
    console.warn('기존 설계도의 원문 정리에 실패했습니다:', err);
  }

  // 파일 선택 상자는 화면을 다시 그리면 초기화되므로, 목록 표시는 이벤트에서만 바꿉니다.
  await renderList();
}
