// js/settings.js
// 설정 탭: 동의 모달, AI 제공자·키·모델, 학원 정보(로고 위치·정렬·크기), 데이터 관리, 피드백 링크를 담당합니다.

import {
  getSettings,
  saveSettings,
  exportBackup,
  importBackup,
  clearAll,
} from './db.js';
import { saveFileWithDialog } from './autosave.js';
import { mountLogoControls, normalizeLogoSettings } from './logo.js';

// 구글 폼 주소입니다.
const FEEDBACK_URL = 'https://forms.gle/MWUFqzX9e9qKxWCu5';
const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';
const LOGO_MAX_BYTES = 1024 * 1024;
const SESSION_KEY = 'exam-maker-session-key';

const PROVIDERS = {
  gemini: {
    label: 'Google Gemini (무료 등급 가능)',
    keyUrl: GEMINI_KEY_URL,
    models: [
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.1-pro-preview',
    ],
    defaults: {
      analyze: 'gemini-3.6-flash',
      generate: 'gemini-3.5-flash-lite',
      verify: 'gemini-3.6-flash',
    },
  },
  claude: {
    label: 'Anthropic Claude (유료, 저렴)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    defaults: {
      analyze: 'claude-haiku-5-5',
      generate: 'claude-haiku-5-5',
      verify: 'claude-haiku-5-5',
    },
  },
};

const STAGES = [
  { key: 'analyze', label: '기출 분석 (이미지/PDF 읽기)' },
  { key: 'generate', label: '문제 생성 / 재생성' },
  { key: 'verify', label: '검산' },
];

const CONSENT_ITEMS = [
  '학원 강사 등 성인 교육 종사자입니다.',
  '이용 권한이 있는 자료만 입력합니다.',
  '생성물은 AI가 만든 것으로 오류가 있을 수 있으며, 검수와 이용 책임은 사용자에게 있습니다.',
  '학생 개인정보(이름, 연락처 등)를 입력하지 않습니다.',
];

// 로고 위치·정렬·크기(logoPercent)는 normalizeLogoSettings()가 채워 줍니다.
const DEFAULT_SETTINGS = {
  provider: 'gemini',
  apiKey: '',
  apiKeyProvider: '',
  rememberKey: false,
  models: {
    gemini: { ...PROVIDERS.gemini.defaults },
    claude: { ...PROVIDERS.claude.defaults },
  },
  academyName: '',
  logo: null,
  logoPosition: 'top',   // 'top' (상단) | 'bottom' (하단)
  logoAlign: 'center',   // 'left' | 'center' | 'right'
  consentAt: null,
};

const STYLE = `
.st-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 720px) { .st-grid { grid-template-columns: 1fr; } }
.st-card { border: 1px solid #e3e6ea; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.st-card h3 { margin-top: 0; font-size: 17px; }
.st-card h4 { margin: 16px 0 8px; font-size: 15px; }
.st-field { display: block; margin-bottom: 12px; }
.st-field > span { display: block; font-size: 14px; font-weight: bold; margin-bottom: 4px; }
.st-field input, .st-field select { width: 100%; padding: 8px; border: 1px solid #bbb; border-radius: 6px; font-size: 14px; }
.st-check { display: flex; gap: 8px; align-items: flex-start; margin: 6px 0; font-size: 14px; }
.st-btn { padding: 8px 14px; border: 1px solid #000; background: #000; color: #fff; border-radius: 6px; cursor: pointer; margin: 4px 6px 4px 0; font-size: 14px; text-decoration: none; display: inline-block; }
.st-btn:disabled { background: #aaa; border-color: #aaa; cursor: not-allowed; }
.st-danger { background: #000; color: #fff; border-color: #000; }
.st-hint { color: #666; font-size: 13px; }
.st-notice { background: #eef4ff; border: 1px solid #5b8def; padding: 10px; border-radius: 6px; font-size: 14px; line-height: 1.6; margin-top: 12px; }
.st-logo-preview { max-height: 80px; border: 1px solid #ddd; padding: 4px; margin: 8px 0; display: block; }
.st-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.st-modal { background: #fff; border-radius: 10px; padding: 24px; max-width: 520px; width: 100%; }
.st-modal h3 { margin-top: 0; }
.st-modal .st-btn { width: 100%; margin-top: 12px; padding: 10px; }
`;

let state = null;

/** HTML에 넣을 글자를 안전하게 바꿉니다. */
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 예전 2.5 모델 이름이거나 비어 있으면 기본값(3.x)으로 바꿉니다. */
function migrateModel(name, fallback) {
  if (!name || /^gemini-2\.5/.test(name)) return fallback;
  return name;
}

/** 저장된 설정에 기본값을 채워 넣습니다. 예전 2.5 모델과 로고 크기(small/medium/large)도 새 값으로 바꿉니다. */
function mergeWithDefaults(stored) {
  const s = stored || {};
  const gemini = { ...DEFAULT_SETTINGS.models.gemini, ...(s.models?.gemini || {}) };
  const claude = { ...DEFAULT_SETTINGS.models.claude, ...(s.models?.claude || {}) };

  for (const st of STAGES) {
    gemini[st.key] = migrateModel(gemini[st.key], PROVIDERS.gemini.defaults[st.key]);
  }

  const merged = {
    ...DEFAULT_SETTINGS,
    ...s,
    models: { gemini, claude },
  };
  return normalizeLogoSettings(merged);
}

/** 이 탭(세션)에 임시로 저장된 키를 읽습니다. */
function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

/** 현재 제공자에 맞는 API 키를 고릅니다. 세션 키를 우선합니다. */
function resolveKey(s) {
  const session = readSession();
  if (session && session.provider === s.provider && session.key) return session.key;
  if (s.apiKey && s.apiKeyProvider === s.provider) return s.apiKey;
  return '';
}

/**
 * 다른 파일(ai.js)이 쓰는 함수입니다. 현재 제공자의 API 키를 돌려줍니다.
 */
export async function getApiKey() {
  return resolveKey(mergeWithDefaults(await getSettings()));
}

/**
 * 설정을 DB에 저장합니다. '이 기기에 저장'이 꺼져 있으면 키는 빼고 저장합니다.
 * 로고 위치·정렬·크기는 logo.js가 DB에 직접 저장하므로, 저장 전에 DB 값을 다시 읽어 맞춥니다.
 */
async function persist() {
  const latest = mergeWithDefaults(await getSettings());
  state.logoPosition = latest.logoPosition;
  state.logoAlign = latest.logoAlign;
  state.logoPercent = latest.logoPercent;

  const toStore = { ...state };
  if (!state.rememberKey) {
    delete toStore.apiKey;
    delete toStore.apiKeyProvider;
  }
  await saveSettings(toStore);
}

/** 설정 화면을 다시 그립니다. */
function render() {
  const panel = document.getElementById('tab-settings');
  const p = PROVIDERS[state.provider];

  const providerOptions = Object.entries(PROVIDERS)
    .map(([id, info]) =>
      `<option value="${id}" ${id === state.provider ? 'selected' : ''}>${esc(info.label)}</option>`)
    .join('');

  const modelRows = STAGES.map((st) => {
    const current = state.models[state.provider][st.key];
    const list = [...new Set([current, ...p.models])];
    return `
      <label class="st-field">
        <span>${esc(st.label)}</span>
        <select data-stage="${st.key}">
          ${list.map((m) => `<option value="${esc(m)}" ${m === current ? 'selected' : ''}>${esc(m)}</option>`).join('')}
        </select>
      </label>`;
  }).join('');

  const logoBox = state.logo
    ? `<img class="st-logo-preview" src="${state.logo}" alt="로고 미리보기">`
    : '<p class="st-hint">등록된 로고가 없습니다.</p>';

  panel.innerHTML = `
    <h2>설정</h2>
    <div class="st-grid">
      <section class="st-card">
        <h3>AI 설정</h3>
        <label class="st-field">
          <span>제공자</span>
          <select id="st-provider">${providerOptions}</select>
        </label>
        <label class="st-field">
          <span>API 키</span>
          <input id="st-key" type="password" autocomplete="off" placeholder="키를 붙여넣으세요" value="${esc(resolveKey(state))}">
        </label>
        <label class="st-check">
          <input type="checkbox" id="st-remember" ${state.rememberKey ? 'checked' : ''}>
          이 기기에 저장 (해제하면 이 탭을 닫을 때 키가 지워집니다)
        </label>
        <h4>단계별 모델</h4>
        ${modelRows}
        <button class="st-btn" id="st-test">연결 테스트</button>
        <span class="st-hint" id="st-test-result"></span>
      </section>

      <section class="st-card">
        <h3>학원 정보</h3>
        <label class="st-field">
          <span>학원명</span>
          <input id="st-academy" maxlength="40" value="${esc(state.academyName)}">
        </label>
        <label class="st-field">
          <span>로고 (PNG/JPG, 1MB 이하)</span>
          <input id="st-logo-file" type="file" accept="image/png,image/jpeg">
        </label>
        ${logoBox}
        <button class="st-btn" id="st-logo-remove">로고 삭제</button>

        <h4>로고 표시 설정 (출력 문제지에 적용)</h4>
        <div id="st-logo-ctrl"></div>
      </section>
    </div>

    <section class="st-card">
      <h3>데이터 관리</h3>
      <p class="st-hint">모든 자료는 이 브라우저에만 저장됩니다. 정기적으로 백업 파일을 내려받아 보관하세요. 백업 파일에는 API 키가 들어가지 않습니다.</p>
      <p class="st-hint">설계도를 저장하면 <strong>다운로드 폴더</strong>에 JSON 파일이 자동으로 저장됩니다. 저장 위치를 바꾸려면 Chrome 설정의 다운로드 항목에서 변경할 수 있습니다.</p>
      <button class="st-btn" id="st-backup">백업 내보내기</button>
      <button class="st-btn" id="st-import-btn">백업 불러오기</button>
      <input id="st-import" type="file" accept="application/json,.json" hidden>
      <button class="st-btn st-danger" id="st-clear">전체 삭제</button>
    </section>

    <section class="st-card">
      <h3>피드백</h3>
      <a class="st-btn" href="${FEEDBACK_URL}" target="_blank" rel="noopener">의견 보내기</a>
      <div class="st-notice">
        <strong>API 키 안내</strong><br>
        이 앱은 <strong>본인의 API 키</strong>를 입력해야 AI 기능(기출 분석, 문제 생성, 검산)이 동작합니다.
        키는 본인 계정에서 발급받아 위의 <strong>API 키</strong> 칸에 붙여넣으세요.<br>
        예시: Google Gemini 키는 <a href="${GEMINI_KEY_URL}" target="_blank" rel="noopener">Google AI Studio 키 발급 페이지</a>에서 만들 수 있습니다. 발급된 키는 보통 <code>AIza</code>로 시작합니다.
      </div>
    </section>
  `;

  bindEvents();
  mountLogoControls(document.getElementById('st-logo-ctrl')).catch((err) => {
    console.error(err);
    alert(`로고 설정을 불러오지 못했습니다: ${err.message}`);
  });
}

/** 화면의 버튼과 입력칸에 동작을 연결합니다. */
function bindEvents() {
  const $ = (id) => document.getElementById(id);

  $('st-provider').addEventListener('change', async (e) => {
    state.provider = e.target.value;
    state.apiKey = '';
    state.apiKeyProvider = '';
    sessionStorage.removeItem(SESSION_KEY);
    await persist();
    render();
  });

  $('st-remember').addEventListener('change', async (e) => {
    state.rememberKey = e.target.checked;
    const key = resolveKey(state);
    if (key) {
      state.apiKey = key;
      state.apiKeyProvider = state.provider;
    }
    await persist();
  });

  $('st-key').addEventListener('change', async (e) => {
    const value = e.target.value.trim();
    state.apiKey = value;
    state.apiKeyProvider = state.provider;
    if (value) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ provider: state.provider, key: value }));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
    await persist();
  });

  document.querySelectorAll('select[data-stage]').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      state.models[state.provider][e.target.dataset.stage] = e.target.value;
      await persist();
    });
  });

  $('st-test').addEventListener('click', onTestConnection);

  $('st-academy').addEventListener('change', async (e) => {
    state.academyName = e.target.value.trim();
    await persist();
  });

  $('st-logo-file').addEventListener('change', onLogoChange);

  $('st-logo-remove').addEventListener('click', async () => {
    state.logo = null;
    await persist();
    render();
  });

  $('st-backup').addEventListener('click', onBackup);
  $('st-import-btn').addEventListener('click', () => $('st-import').click());
  $('st-import').addEventListener('change', onImport);
  $('st-clear').addEventListener('click', onClear);
}

/** 연결 테스트. ai.js는 4단계에서 만듭니다. 파일이 없으면 안내만 보여 줍니다. */
async function onTestConnection() {
  const out = document.getElementById('st-test-result');
  out.textContent = '연결 확인 중...';

  let ai;
  try {
    ai = await import('./ai.js');
  } catch {
    out.textContent = 'AI 연결 기능은 4단계(AI 어댑터)에서 추가됩니다.';
    return;
  }

  try {
    const text = await ai.testConnection({
      provider: state.provider,
      apiKey: await getApiKey(),
      model: state.models[state.provider].generate,
    });
    out.textContent = `연결 성공: ${text}`;
  } catch (err) {
    out.textContent = err.message || '연결에 실패했습니다.';
  }
}

/** 로고 파일을 검사한 뒤 dataURL로 저장합니다. */
function onLogoChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    alert('PNG 또는 JPG 파일만 올릴 수 있습니다.');
    e.target.value = '';
    return;
  }
  if (file.size > LOGO_MAX_BYTES) {
    alert('로고 파일은 1MB 이하만 가능합니다.');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    state.logo = reader.result;
    await persist();
    render();
  };
  reader.readAsDataURL(file);
}

async function onBackup() {
  try {
    const data = await exportBackup();
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const today = new Date().toISOString().slice(0, 10);
    const name = await saveFileWithDialog(text, `exam-maker-backup-${today}.json`);
    if (name) alert(`백업을 저장했습니다: ${name}`);
  } catch (err) {
    alert(`백업에 실패했습니다: ${err.message}`);
  }
}

async function onImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const result = await importBackup(file);
    alert(`불러오기 완료\n설계도 ${result.blueprints}개, 지문 ${result.passages}개, 세트 ${result.sets}개`);
    state = mergeWithDefaults(await getSettings());
    render();
  } catch (err) {
    alert(err.message);
  } finally {
    e.target.value = '';
  }
}

async function onClear() {
  const ok = confirm('설계도, 지문, 세트, 설정을 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?');
  if (!ok) return;

  await clearAll();
  sessionStorage.removeItem(SESSION_KEY);
  alert('삭제되었습니다. 페이지를 새로고침하면 동의 화면부터 다시 시작합니다.');
  location.reload();
}

/** 첫 접속 때 나타나는 동의 모달입니다. 네 항목을 모두 체크해야 시작할 수 있습니다. */
function showConsentModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'st-overlay';
    overlay.innerHTML = `
      <div class="st-modal">
        <h3>이용 전 확인</h3>
        <p>아래 항목에 모두 동의해야 이용할 수 있습니다.</p>
        ${CONSENT_ITEMS.map((text, i) => `
          <label class="st-check">
            <input type="checkbox" class="st-consent" data-i="${i}">
            <span>${esc(text)}</span>
          </label>`).join('')}
        <button class="st-btn" id="st-agree" disabled>동의하고 시작</button>
      </div>`;
    document.body.appendChild(overlay);

    const boxes = overlay.querySelectorAll('.st-consent');
    const agree = overlay.querySelector('#st-agree');
    const refresh = () => {
      agree.disabled = ![...boxes].every((b) => b.checked);
    };
    boxes.forEach((b) => b.addEventListener('change', refresh));

    agree.addEventListener('click', () => {
      overlay.remove();
      resolve();
    });
  });
}

/** main.js가 호출하는 시작 함수입니다. */
export async function initSettings() {
  const panel = document.getElementById('tab-settings');
  if (!panel) return;

  if (!document.getElementById('settings-style')) {
    const style = document.createElement('style');
    style.id = 'settings-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  state = mergeWithDefaults(await getSettings());
  render();

  if (!state.consentAt) {
    await showConsentModal();
    state.consentAt = new Date().toISOString();
    await persist();
  }
}
