// js/generate.js
// 변형문제 생성 탭: 지문과 설계도를 골라 AI로 문제를 만들고, 검산·재생성·세트 저장을 담당합니다.

import { callAIJson, AIError } from './ai.js';
import { buildGeneratePrompt, buildRegeneratePrompt, buildVerifyPrompt, compareVerify } from './prompts.js';
import { validateItem, typeLabel } from './schema.js';
import { getAll, getItem, putItem, deleteItem } from './db.js';

const MODE_LABEL = { same: '같은 난이도', easier: '쉽게', harder: '어렵게' };
const VERDICT = {
  PASS: { text: '검산 통과', cls: 'gn-ok' },
  FAIL: { text: '검산 실패 (직접 확인)', cls: 'gn-err' },
  PENDING: { text: '직접 확인 필요', cls: 'gn-hint' },
};

const STYLE = `
.gn-card { border: 1px solid #e3e6ea; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.gn-card h3 { margin-top: 0; font-size: 17px; }
.gn-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 720px) { .gn-grid2 { grid-template-columns: 1fr; } }
.gn-field { display: block; margin-bottom: 12px; }
.gn-field > span { display: block; font-size: 14px; font-weight: bold; margin-bottom: 4px; }
.gn-field select { width: 100%; padding: 8px; border: 1px solid #bbb; border-radius: 6px; font-size: 14px; }
.gn-btn { padding: 8px 14px; border: 1px solid #000; background: #000; color: #fff; border-radius: 6px; cursor: pointer; margin: 4px 6px 4px 0; font-size: 14px; }
.gn-btn:disabled { background: #aaa; border-color: #aaa; cursor: not-allowed; }
.gn-light { background: #fff; color: #000; }
.gn-danger { background: #fff; color: #c62828; border-color: #c62828; }
.gn-small { padding: 4px 8px; font-size: 12px; }
.gn-hint { color: #666; font-size: 13px; }
.gn-status { font-size: 14px; font-weight: bold; margin-left: 8px; }
.gn-ok { color: #2e7d32; font-weight: bold; font-size: 13px; }
.gn-err { color: #c62828; font-weight: bold; font-size: 13px; }
.gn-item { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.gn-item-error { background: #fdecea; }
.gn-item-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 14px; }
.gn-stem { white-space: pre-wrap; font-size: 15px; }
.gn-body { white-space: pre-wrap; background: #f7f7f7; padding: 8px; border-radius: 6px; font-size: 14px; font-family: inherit; }
.gn-choices { font-size: 14px; margin: 6px 0; }
.gn-choices p { margin: 2px 0; }
.gn-explain { white-space: pre-wrap; font-size: 13px; color: #444; }
.gn-scroll { overflow-x: auto; }
.gn-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.gn-table th, .gn-table td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: middle; }
.gn-table th { background: #f4f6f8; white-space: nowrap; }
`;

let panel = null;
let state = emptyState();

function emptyState() {
  return {
    setId: null,
    createdAt: null,
    passageId: '',
    blueprintId: '',
    passage: null,   // { title, text } 스냅샷 (지문을 나중에 지워도 세트는 남도록 보관)
    blueprintLabel: '',
    items: [],
    verify: {},      // 문제 번호(인덱스) → 검산 결과
  };
}

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

/** 작업 중에는 상태 문구를 보여 주고 버튼을 잠급니다. 빈 문자열이면 잠금을 풉니다. */
function setBusy(message) {
  const status = document.getElementById('gn-status');
  if (status) status.textContent = message;
  panel.querySelectorAll('button').forEach((b) => { b.disabled = Boolean(message); });
}

/** 설계도 카드에서 AI에 보내도 되는 항목만 골라냅니다. 기출 원문(originalText)은 빼고 보냅니다. */
function toPlan(card) {
  return {
    no: card.no,
    type: card.type,
    format: card.format,
    stemPattern: card.stemPattern || '',
    point: card.point || '',
    difficulty: card.difficulty,
    score: card.score ?? null,
    choices: card.choices ?? null,
    visual: card.visual || '',
    note: card.note || '',
  };
}

function blueprintLabel(bp) {
  return `${bp.school} ${bp.grade} ${bp.exam} ${bp.year} (${(bp.cards || []).length}문항)`;
}

/** 탭 전체 골격을 그립니다. */
function renderShell() {
  panel.innerHTML = `
    <h2>변형문제 생성</h2>

    <section class="gn-card">
      <h3>1. 재료 선택</h3>
      <div class="gn-grid2">
        <label class="gn-field"><span>지문 (시험 범위 탭)</span><select id="gn-passage"></select></label>
        <label class="gn-field"><span>설계도 (기출 분석 탭)</span><select id="gn-blueprint"></select></label>
      </div>
      <p class="gn-hint">설계도의 유형과 난이도 구성에 맞춰 지문으로 새 문제를 만듭니다. 기출 원문은 AI에 보내지 않습니다. 지문이나 설계도를 새로 추가했다면 Ctrl+F5로 새로고침하세요.</p>
      <button class="gn-btn" data-action="generate" id="gn-run">변형문제 생성</button>
      <span id="gn-status" class="gn-status"></span>
    </section>

    <section class="gn-card">
      <h3>2. 생성된 문제</h3>
      <div id="gn-items"><p class="gn-hint">아직 생성된 문제가 없습니다.</p></div>
      <button class="gn-btn gn-light" data-action="save" id="gn-save">세트로 저장</button>
      <span id="gn-save-msg" class="gn-hint"></span>
    </section>

    <section class="gn-card">
      <h3>3. 저장된 세트</h3>
      <div id="gn-sets"></div>
    </section>
  `;
}

/** 지문과 설계도 선택 상자를 채웁니다. 이미 고른 값이 있으면 유지합니다. */
async function renderOptions() {
  const passageSel = document.getElementById('gn-passage');
  const bpSel = document.getElementById('gn-blueprint');
  const prevP = passageSel.value || state.passageId;
  const prevB = bpSel.value || state.blueprintId;

  const passages = (await getAll('passages'))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const blueprints = (await getAll('blueprints'))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  passageSel.innerHTML = passages.length
    ? `<option value="">지문을 고르세요</option>` +
      passages.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')
    : '<option value="">지문이 없습니다 (시험 범위 탭에서 추가)</option>';

  bpSel.innerHTML = blueprints.length
    ? `<option value="">설계도를 고르세요</option>` +
      blueprints.map((bp) => `<option value="${esc(bp.id)}">${esc(blueprintLabel(bp))}</option>`).join('')
    : '<option value="">설계도가 없습니다 (기출 분석 탭에서 저장)</option>';

  passageSel.value = prevP || '';
  bpSel.value = prevB || '';
}

/** 생성된 문제 목록을 그립니다. */
function renderItems() {
  const box = document.getElementById('gn-items');
  if (state.items.length === 0) {
    box.innerHTML = '<p class="gn-hint">아직 생성된 문제가 없습니다.</p>';
    return;
  }
  box.innerHTML = state.items.map((item, i) => itemHtml(item, i)).join('');
}

/** 문제 한 개의 HTML을 만듭니다. */
function itemHtml(item, i) {
  const errors = validateItem(item);
  const v = state.verify[i];
  const verdict = v
    ? `<span class="${VERDICT[v.status].cls}">${VERDICT[v.status].text}</span>`
    : '<span class="gn-hint">검산 전</span>';

  const choices = Array.isArray(item.choices) && item.choices.length
    ? `<div class="gn-choices">${item.choices.map((c) => `<p>${esc(c)}</p>`).join('')}</div>`
    : '';
  const body = item.body ? `<pre class="gn-body">${esc(item.body)}</pre>` : '';
  const verifyText = v
    ? `<p class="gn-hint">AI 풀이 답: ${esc(v.answer ?? '-')}${v.issue ? ` / 문제점: ${esc(v.issue)}` : ''}</p>`
    : '';
  const regenButtons = Object.entries(MODE_LABEL)
    .map(([mode, label]) =>
      `<button class="gn-btn gn-light gn-small" data-action="regen" data-mode="${mode}" data-idx="${i}">${label} 재생성</button>`)
    .join('');

  return `
    <div class="gn-item ${errors.length ? 'gn-item-error' : ''}" title="${esc(errors.join(' / '))}">
      <div class="gn-item-head">
        <strong>${esc(item.no ?? i + 1)}번 · ${esc(typeLabel(item.type))} · ${item.format === 'WR' ? '서술형' : '객관식'} · 난이도 ${esc(item.difficulty)}</strong>
        ${verdict}
        ${errors.length ? `<span class="gn-err">검사 오류 ${errors.length}건</span>` : ''}
      </div>
      <p class="gn-stem">${esc(item.stem)}</p>
      ${body}
      ${choices}
      <p><b>정답:</b> ${esc(item.answer)}</p>
      <p class="gn-explain">${esc(item.explanation)}</p>
      ${verifyText}
      <div>
        <button class="gn-btn gn-light gn-small" data-action="verify" data-idx="${i}">검산</button>
        ${regenButtons}
        <button class="gn-btn gn-danger gn-small" data-action="del-item" data-idx="${i}">삭제</button>
      </div>
    </div>`;
}

/** 검산 결과를 PASS, FAIL, PENDING 중 하나로 맞춥니다. */
function verdictOf(result) {
  const raw = typeof result === 'string' ? result : (result?.status || result?.verdict || 'PENDING');
  return VERDICT[raw] ? raw : 'PENDING';
}

/** 지문과 설계도로 문제를 새로 만듭니다. */
async function onGenerate() {
  const passageId = document.getElementById('gn-passage').value;
  const blueprintId = document.getElementById('gn-blueprint').value;
  if (!passageId) return alert('지문을 고르세요. 지문이 없다면 시험 범위 탭에서 먼저 추가하세요.');
  if (!blueprintId) return alert('설계도를 고르세요. 기출 분석 탭에서 먼저 저장하세요.');

  const passage = await getItem('passages', passageId);
  const bp = await getItem('blueprints', blueprintId);
  if (!passage || !bp) return alert('지문 또는 설계도를 찾을 수 없습니다. 새로고침 후 다시 고르세요.');
  if (!bp.cards || bp.cards.length === 0) return alert('설계도에 문항 카드가 없습니다.');

  setBusy('문제를 만드는 중입니다. 1분 안팎 걸릴 수 있습니다...');
  try {
    const prompt = buildGeneratePrompt({
      passage: { title: passage.title, text: passage.text },
      cards: bp.cards.map(toPlan),
    });
    const result = await callAIJson({ stage: 'generate', system: prompt.system, userText: prompt.userText });

    if (!Array.isArray(result?.items) || result.items.length === 0) {
      throw new AIError('AI가 문제를 만들지 못했습니다. 다시 시도하세요.');
    }

    state = {
      ...emptyState(),
      passageId,
      blueprintId,
      passage: { title: passage.title, text: passage.text },
      blueprintLabel: blueprintLabel(bp),
      items: result.items,
    };
    document.getElementById('gn-save-msg').textContent = '';
    renderItems();
    setBusy('');
    document.getElementById('gn-items').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    setBusy('');
    throw err;
  }
}

/** 문제 한 개를 AI가 다시 풀어 정답이 맞는지 확인합니다. */
async function onVerify(i) {
  const item = state.items[i];
  setBusy('검산 중입니다...');
  try {
    const prompt = buildVerifyPrompt(item);
    const result = await callAIJson({ stage: 'verify', system: prompt.system, userText: prompt.userText });
    const status = verdictOf(compareVerify(item, result));
    state.verify[i] = { status, answer: result?.answer, issue: result?.issue };
    renderItems();
  } finally {
    setBusy('');
  }
}

/** 문제 한 개를 같은 난이도, 쉽게, 어렵게 중 하나로 다시 만듭니다. */
async function onRegenerate(i, mode) {
  const item = state.items[i];
  setBusy(`${MODE_LABEL[mode]} 문제로 다시 만드는 중입니다...`);
  try {
    const prompt = buildRegeneratePrompt({ passage: state.passage, item, mode });
    const result = await callAIJson({ stage: 'generate', system: prompt.system, userText: prompt.userText });
    if (!result?.item) throw new AIError('재생성 결과를 읽지 못했습니다. 다시 시도하세요.');

    const next = { ...result.item, no: item.no };
    const errors = validateItem(next);
    if (errors.length > 0) {
      alert(`재생성한 문제에 검사 오류가 있어 바꾸지 않았습니다.\n\n${errors.join('\n')}`);
      return;
    }
    state.items[i] = next;
    delete state.verify[i];
    renderItems();
  } finally {
    setBusy('');
  }
}

/** 문제 한 개를 목록에서 뺍니다. 번호가 바뀌므로 검산 결과는 지웁니다. */
function onDeleteItem(i) {
  if (!confirm(`${i + 1}번 문제를 목록에서 뺄까요?`)) return;
  state.items.splice(i, 1);
  state.verify = {};
  renderItems();
}

/** 생성된 문제 묶음을 세트로 저장합니다. 같은 세트를 다시 저장하면 덮어씁니다. */
async function onSave() {
  const msg = document.getElementById('gn-save-msg');
  if (state.items.length === 0) return alert('저장할 문제가 없습니다.');

  const badCount = state.items.filter((it) => validateItem(it).length > 0).length;
  if (badCount > 0 && !confirm(`검사 오류가 있는 문제가 ${badCount}개 있습니다. 그래도 저장할까요?`)) return;

  const record = {
    id: state.setId || undefined,
    createdAt: state.createdAt || new Date().toISOString(),
    name: `${state.passage.title} · ${state.blueprintLabel}`,
    passageId: state.passageId,
    blueprintId: state.blueprintId,
    passage: state.passage,
    blueprintLabel: state.blueprintLabel,
    items: state.items,
  };
  await putItem('sets', record);
  state.setId = record.id;
  state.createdAt = record.createdAt;
  msg.textContent = '세트를 저장했습니다.';
  await renderSets();
}

/** 저장된 세트 목록을 그립니다. */
async function renderSets() {
  const box = document.getElementById('gn-sets');
  const sets = (await getAll('sets'))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  if (sets.length === 0) {
    box.innerHTML = '<p class="gn-hint">저장된 세트가 없습니다.</p>';
    return;
  }

  box.innerHTML = `
    <div class="gn-scroll">
      <table class="gn-table">
        <thead><tr><th>세트</th><th>문항 수</th><th>저장일</th><th>관리</th></tr></thead>
        <tbody>
          ${sets.map((s) => `
            <tr>
              <td>${esc(s.name)}</td>
              <td>${(s.items || []).length}</td>
              <td>${esc((s.createdAt || '').slice(0, 10))}</td>
              <td>
                <button class="gn-btn gn-light gn-small" data-action="load-set" data-id="${esc(s.id)}">불러오기</button>
                <button class="gn-btn gn-danger gn-small" data-action="del-set" data-id="${esc(s.id)}">삭제</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** 저장된 세트를 화면에 불러옵니다. */
async function onLoadSet(id) {
  const rec = await getItem('sets', id);
  if (!rec) return alert('세트를 찾을 수 없습니다.');

  state = {
    ...emptyState(),
    setId: rec.id,
    createdAt: rec.createdAt,
    passageId: rec.passageId || '',
    blueprintId: rec.blueprintId || '',
    passage: rec.passage,
    blueprintLabel: rec.blueprintLabel || '',
    items: rec.items || [],
  };
  await renderOptions();
  renderItems();
  document.getElementById('gn-save-msg').textContent = `불러온 세트: ${rec.name}`;
  document.getElementById('gn-items').scrollIntoView({ behavior: 'smooth' });
}

async function onDeleteSet(id) {
  if (!confirm('이 세트를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
  await deleteItem('sets', id);
  if (state.setId === id) state.setId = null;
  await renderSets();
}

/** 탭 안의 버튼 클릭을 한 곳에서 처리합니다. */
function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const { action, id, mode } = btn.dataset;
  const idx = Number(btn.dataset.idx);

  if (action === 'generate') return safe(onGenerate);
  if (action === 'verify') return safe(onVerify, idx);
  if (action === 'regen') return safe(onRegenerate, idx, mode);
  if (action === 'del-item') return onDeleteItem(idx);
  if (action === 'save') return safe(onSave);
  if (action === 'load-set') return safe(onLoadSet, id);
  if (action === 'del-set') return safe(onDeleteSet, id);
}

/** 변형문제 생성 탭을 시작합니다. main.js가 호출합니다. */
export async function initGenerate() {
  panel = document.getElementById('tab-generate');
  if (!panel) return;

  if (!document.getElementById('generate-style')) {
    const style = document.createElement('style');
    style.id = 'generate-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  renderShell();
  panel.addEventListener('click', onClick);
  await Promise.all([renderOptions(), renderSets()]);
}
