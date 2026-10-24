// js/passages.js
// 시험 범위 탭: 지문 추가·수정·삭제, '---'로 여러 지문을 한 번에 입력하는 기능을 담당합니다.

import { getAll, getItem, putItem, deleteItem } from './db.js';

const MAX_TEXT_LENGTH = 20000;

const STYLE = `
.ps-card { border: 1px solid #e3e6ea; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.ps-card h3 { margin-top: 0; font-size: 17px; }
.ps-field { display: block; margin-bottom: 12px; }
.ps-field > span { display: block; font-size: 14px; font-weight: bold; margin-bottom: 4px; }
.ps-field input, .ps-field textarea { width: 100%; padding: 8px; border: 1px solid #bbb; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
.ps-btn { padding: 8px 14px; border: 1px solid #000; background: #000; color: #fff; border-radius: 6px; cursor: pointer; margin: 4px 6px 4px 0; font-size: 14px; }
.ps-light { background: #fff; color: #000; }
.ps-danger { background: #fff; color: #c62828; border-color: #c62828; }
.ps-small { padding: 4px 8px; font-size: 12px; }
.ps-hint { color: #666; font-size: 13px; }
.ps-warn { color: #c62828; font-weight: bold; }
.ps-scroll { overflow-x: auto; }
.ps-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ps-table th, .ps-table td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: middle; }
.ps-table th { background: #f4f6f8; white-space: nowrap; }
.ps-preview { color: #666; font-size: 12px; }
`;

let panel = null;
let editingId = null; // 수정 중인 지문의 id (null이면 새로 추가 중)

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

/** 영어 단어 수를 셉니다(공백 기준). */
function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

/** 탭 전체 골격을 그립니다. */
function renderShell() {
  panel.innerHTML = `
    <h2>시험 범위 (지문)</h2>

    <section class="ps-card">
      <h3>1. 지문 추가 / 수정</h3>
      <label class="ps-field">
        <span>제목</span>
        <input id="ps-title" maxlength="80" placeholder="예: Unit 3 본문">
      </label>
      <label class="ps-field">
        <span>본문</span>
        <textarea id="ps-text" rows="8" placeholder="영어 지문을 붙여넣으세요."></textarea>
      </label>
      <p class="ps-hint" id="ps-count"></p>
      <button class="ps-btn" data-action="save-one" id="ps-save">추가</button>
      <button class="ps-btn ps-light" data-action="reset">입력 지우기 / 수정 취소</button>
      <span id="ps-msg" class="ps-hint"></span>
    </section>

    <section class="ps-card">
      <h3>2. 여러 지문 한 번에 입력</h3>
      <p class="ps-hint">지문 사이에 <b>---</b> 한 줄을 넣으세요. 각 덩어리의 첫 줄은 제목, 나머지 줄은 본문이 됩니다. 하나라도 잘못되면 아무것도 저장하지 않습니다.</p>
      <label class="ps-field">
        <span>일괄 입력</span>
        <textarea id="ps-bulk" rows="8"></textarea>
      </label>
      <button class="ps-btn" data-action="bulk">일괄 등록</button>
      <span id="ps-bulk-msg" class="ps-hint"></span>
    </section>

    <section class="ps-card">
      <h3>3. 저장된 지문</h3>
      <div id="ps-list"></div>
    </section>
  `;
  updateCount();
}

/** 본문 글자 수와 단어 수를 보여 줍니다. 최대 길이를 넘으면 붉게 표시합니다. */
function updateCount() {
  const text = document.getElementById('ps-text').value;
  const el = document.getElementById('ps-count');
  el.textContent = `${text.length.toLocaleString()}자 · 단어 ${countWords(text)}개 (최대 ${MAX_TEXT_LENGTH.toLocaleString()}자)`;
  el.classList.toggle('ps-warn', text.length > MAX_TEXT_LENGTH);
}

/** 입력한 지문 한 개를 검사합니다. 문제가 없으면 빈 배열을 돌려줍니다. */
function checkItem(item) {
  const errors = [];
  if (!item.title) errors.push('제목이 없습니다');
  if (!item.text) errors.push('본문이 없습니다');
  if (item.text && item.text.length > MAX_TEXT_LENGTH) {
    errors.push(`본문이 ${MAX_TEXT_LENGTH.toLocaleString()}자를 넘습니다`);
  }
  return errors;
}

/** '---' 한 줄을 기준으로 지문을 나눕니다. 각 덩어리의 첫 줄은 제목, 나머지는 본문입니다. */
function parseBulk(raw) {
  return raw
    .split(/^[ \t]*---[ \t]*$/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, i) => {
      const lines = block.split('\n');
      return {
        no: i + 1,
        title: lines[0].trim(),
        text: lines.slice(1).join('\n').trim(),
      };
    });
}

/** 지문 목록 표를 그립니다. */
async function renderList() {
  const box = document.getElementById('ps-list');
  const items = (await getAll('passages'))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  if (items.length === 0) {
    box.innerHTML = '<p class="ps-hint">저장된 지문이 없습니다. 위에서 추가하세요.</p>';
    return;
  }

  box.innerHTML = `
    <p class="ps-hint">총 ${items.length}개</p>
    <div class="ps-scroll">
      <table class="ps-table">
        <thead>
          <tr><th>번호</th><th>제목</th><th>단어 수</th><th>등록일</th><th>관리</th></tr>
        </thead>
        <tbody>
          ${items.map((p, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${esc(p.title)}<br><span class="ps-preview">${esc(String(p.text || '').slice(0, 60))}${(p.text || '').length > 60 ? '...' : ''}</span></td>
              <td>${countWords(p.text)}</td>
              <td>${esc((p.createdAt || '').slice(0, 10))}</td>
              <td>
                <button class="ps-btn ps-light ps-small" data-action="edit" data-id="${esc(p.id)}">수정</button>
                <button class="ps-btn ps-danger ps-small" data-action="del" data-id="${esc(p.id)}">삭제</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** 입력 칸을 비우고 추가 모드로 되돌립니다. */
function resetForm() {
  editingId = null;
  document.getElementById('ps-title').value = '';
  document.getElementById('ps-text').value = '';
  document.getElementById('ps-save').textContent = '추가';
  document.getElementById('ps-msg').textContent = '';
  updateCount();
}

/** 지문 한 개를 추가하거나, 수정 중이면 그 지문을 고칩니다. */
async function onSaveOne() {
  const title = document.getElementById('ps-title').value.trim();
  const text = document.getElementById('ps-text').value.trim();

  const errors = checkItem({ title, text });
  if (errors.length > 0) return alert(`저장할 수 없습니다: ${errors.join(', ')}`);

  if (editingId) {
    const old = await getItem('passages', editingId);
    if (!old) return alert('지문을 찾을 수 없습니다. 목록을 새로고침하세요.');
    await putItem('passages', { ...old, title, text, updatedAt: new Date().toISOString() });
    resetForm();
    document.getElementById('ps-msg').textContent = '수정했습니다.';
  } else {
    await putItem('passages', { title, text, createdAt: new Date().toISOString() });
    resetForm();
    document.getElementById('ps-msg').textContent = '추가했습니다.';
  }
  await renderList();
}

/** 여러 지문을 한 번에 저장합니다. 하나라도 틀리면 아무것도 저장하지 않습니다. */
async function onBulk() {
  const raw = document.getElementById('ps-bulk').value;
  const msg = document.getElementById('ps-bulk-msg');
  const items = parseBulk(raw);

  if (items.length === 0) return alert('입력된 지문이 없습니다.');

  const problems = [];
  items.forEach((item) => {
    const errors = checkItem(item);
    if (errors.length > 0) problems.push(`${item.no}번 지문: ${errors.join(', ')}`);
  });
  if (problems.length > 0) {
    return alert(`저장하지 않았습니다. 아래 항목을 고쳐 주세요.\n\n${problems.slice(0, 8).join('\n')}`);
  }

  if (!confirm(`지문 ${items.length}개를 저장할까요?`)) return;

  for (const item of items) {
    await putItem('passages', {
      title: item.title,
      text: item.text,
      createdAt: new Date().toISOString(),
    });
  }

  document.getElementById('ps-bulk').value = '';
  msg.textContent = `${items.length}개 지문을 저장했습니다.`;
  await renderList();
}

/** 목록의 수정 버튼: 지문을 입력 칸에 채우고 수정 모드로 바꿉니다. */
async function onEdit(id) {
  const p = await getItem('passages', id);
  if (!p) return alert('지문을 찾을 수 없습니다.');

  editingId = id;
  document.getElementById('ps-title').value = p.title || '';
  document.getElementById('ps-text').value = p.text || '';
  document.getElementById('ps-save').textContent = '수정 저장';
  document.getElementById('ps-msg').textContent = '수정 중입니다. 저장하면 이 지문이 바뀝니다.';
  updateCount();
  panel.scrollIntoView({ behavior: 'smooth' });
}

/** 목록의 삭제 버튼: 확인 후 지웁니다. */
async function onDelete(id) {
  const p = await getItem('passages', id);
  const name = p ? p.title : '';
  if (!confirm(`"${name}" 지문을 삭제할까요? 되돌릴 수 없습니다.`)) return;

  await deleteItem('passages', id);
  if (editingId === id) resetForm();
  await renderList();
}

/** 탭 안의 버튼 클릭을 한 곳에서 처리합니다. */
function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === 'save-one') return safe(onSaveOne);
  if (action === 'reset') return resetForm();
  if (action === 'bulk') return safe(onBulk);
  if (action === 'edit') return safe(onEdit, id);
  if (action === 'del') return safe(onDelete, id);
}

function onInput(e) {
  if (e.target.id === 'ps-text') updateCount();
}

/** 시험 범위 탭을 시작합니다. main.js가 호출합니다. */
export async function initPassages() {
  panel = document.getElementById('tab-passages');
  if (!panel) return;

  if (!document.getElementById('passages-style')) {
    const style = document.createElement('style');
    style.id = 'passages-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  renderShell();
  panel.addEventListener('click', onClick);
  panel.addEventListener('input', onInput);
  await renderList();
}
