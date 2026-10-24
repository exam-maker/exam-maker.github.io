// js/main.js
// 앱 시작점: 탭 전환과 각 탭의 시작 함수를 연결합니다.

import { initSettings } from './settings.js';
import { initAnalyze } from './analyze.js';
import { initPassages } from './passages.js';
import { initGenerate } from './generate.js';
import { initPrint } from './print.js';

const DEFAULT_TAB = 'settings';
const VALID_TABS = ['settings', 'analyze', 'passages', 'generate', 'print'];

/** 선택한 탭의 버튼과 화면을 켜고, 주소의 #해시를 갱신합니다. */
function showTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === tabName);
  });
  history.replaceState(null, '', `#${tabName}`);
}

/** 주소의 #해시에서 탭 이름을 읽습니다. 없거나 잘못되면 기본 탭을 씁니다. */
function getTabFromHash() {
  const name = location.hash.replace('#', '');
  return VALID_TABS.includes(name) ? name : DEFAULT_TAB;
}

function init() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  window.addEventListener('hashchange', () => showTab(getTabFromHash()));
  showTab(getTabFromHash());

  initSettings().catch((err) => alert(`설정을 불러오지 못했습니다: ${err.message}`));
  initAnalyze().catch((err) => alert(`기출 분석 탭을 불러오지 못했습니다: ${err.message}`));
  initPassages().catch((err) => alert(`시험 범위 탭을 불러오지 못했습니다: ${err.message}`));
  initGenerate().catch((err) => alert(`변형문제 탭을 불러오지 못했습니다: ${err.message}`));
  initPrint().catch((err) => alert(`출력 탭을 불러오지 못했습니다: ${err.message}`));
}

init();
