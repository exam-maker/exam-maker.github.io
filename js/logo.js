// js/logo.js
// 로고 위치·정렬·크기(%) 설정 UI를 그립니다. 설정 탭 위쪽의 로고 이미지가 미리보기 역할을 합니다.

import { getSettings, saveSettings } from './db.js';

const BASE_WIDTH_PX = 150;  // 100%일 때 로고 가로 길이(px)
const MIN_PERCENT = 30;
const MAX_PERCENT = 200;
const STEP_PERCENT = 10;

const POSITION_OPTIONS = [
  { value: 'top', label: '상단' },
  { value: 'bottom', label: '하단' },
];
const ALIGN_OPTIONS = [
  { value: 'left', label: '좌측' },
  { value: 'center', label: '중앙' },
  { value: 'right', label: '우측' },
];

// 이전 버전(small/medium/large)에서 넘어온 설정을 % 값으로 바꿔 줍니다.
export function normalizeLogoSettings(s) {
  const out = { ...s };
  if (!out.logoPosition) out.logoPosition = 'top';
  if (!out.logoAlign) out.logoAlign = 'center';
  if (!out.logoPercent) {
    const map = { small: 67, medium: 100, large: 150 };
    out.logoPercent = map[out.logoSize] || 100;
  }
  out.logoPercent = clamp(Math.round(out.logoPercent / STEP_PERCENT) * STEP_PERCENT);
  return out;
}

export function logoWidthPx(settings) {
  const p = normalizeLogoSettings(settings).logoPercent;
  return Math.round((BASE_WIDTH_PX * p) / 100);
}

function clamp(v) {
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, v));
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function segHtml(key, options, current) {
  return `<div class="seg" data-key="${key}">` +
    options.map(o =>
      `<button type="button" data-val="${o.value}" class="${o.value === current ? 'active' : ''}">${o.label}</button>`
    ).join('') +
    `</div>`;
}

/** 설정 탭 위쪽의 로고 이미지를 현재 설정(크기, 정렬)에 맞춰 바꿉니다. */
function applyPreview(s) {
  const img = document.querySelector('#tab-settings .st-logo-preview');
  if (!img) return;

  img.style.display = 'block';
  img.style.width = `${logoWidthPx(s)}px`;
  img.style.height = 'auto';
  img.style.maxWidth = '100%';
  img.style.maxHeight = 'none';

  if (s.logoAlign === 'left') {
    img.style.marginLeft = '0';
    img.style.marginRight = 'auto';
  } else if (s.logoAlign === 'right') {
    img.style.marginLeft = 'auto';
    img.style.marginRight = '0';
  } else {
    img.style.marginLeft = 'auto';
    img.style.marginRight = 'auto';
  }
}

function render(container, s) {
  container.innerHTML = `
    <div class="logo-ctrl">
      <div class="logo-row">
        <span class="logo-label">위치</span>
        ${segHtml('logoPosition', POSITION_OPTIONS, s.logoPosition)}
      </div>
      <div class="logo-row">
        <span class="logo-label">정렬</span>
        ${segHtml('logoAlign', ALIGN_OPTIONS, s.logoAlign)}
      </div>
      <div class="logo-row">
        <span class="logo-label">크기</span>
        <button type="button" class="pct-btn" data-step="-${STEP_PERCENT}">−</button>
        <span class="pct-value">${s.logoPercent}%</span>
        <button type="button" class="pct-btn" data-step="${STEP_PERCENT}">+</button>
        <button type="button" class="seg-reset" data-reset="1">100%로 되돌리기</button>
      </div>
      <p class="logo-hint">
        ${s.logo
          ? '위 로고 이미지가 지금 고른 정렬과 크기로 바뀝니다.'
          : '로고를 올리면 위 칸에서 정렬과 크기를 미리 볼 수 있습니다.'}
        ${s.logoPosition === 'bottom'
          ? '하단을 고르면 문제지의 맨 끝(정답·해설 다음)에 로고가 들어갑니다.'
          : '상단을 고르면 문제지 맨 위에 로고가 들어갑니다.'}
        크기는 ${MIN_PERCENT}%~${MAX_PERCENT}% 사이에서 ${STEP_PERCENT}%씩 조절됩니다.
      </p>
    </div>`;
  applyPreview(s);
}

async function update(container, patch) {
  const current = normalizeLogoSettings(await getSettings());
  const next = normalizeLogoSettings({ ...current, ...patch });
  await saveSettings(next);
  render(container, next);
}

// 설정 탭의 로고 영역 안에 호출합니다. 예: mountLogoControls(document.getElementById('st-logo-ctrl'))
export async function mountLogoControls(container) {
  const s = normalizeLogoSettings(await getSettings());
  render(container, s);

  if (container.dataset.bound === '1') return;
  container.dataset.bound = '1';

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const current = normalizeLogoSettings(await getSettings());

    if (btn.dataset.step) {
      const p = clamp(current.logoPercent + Number(btn.dataset.step));
      return update(container, { logoPercent: p });
    }
    if (btn.dataset.reset) {
      return update(container, { logoPercent: 100 });
    }
    const seg = btn.closest('.seg');
    if (seg && btn.dataset.val) {
      return update(container, { [seg.dataset.key]: btn.dataset.val });
    }
  });
}
