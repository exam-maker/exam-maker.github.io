// js/ai.js
// AI 어댑터: 제공자별 요청 생성, 파일 base64 변환, 오류 처리, 재시도를 담당합니다.
// 이번 단계에서는 Gemini만 연결되어 있고, Claude는 다음 단계에서 추가합니다.

import { getSettings } from './db.js';
import { getApiKey } from './settings.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 2;

/** AI 호출 오류입니다. 화면에 그대로 보여 줄 수 있는 문장을 담습니다. */
export class AIError extends Error {
  constructor(message, { status = 0, provider = '' } = {}) {
    super(message);
    this.name = 'AIError';
    this.status = status;
    this.provider = provider;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 파일(PDF, PNG, JPG)을 base64 문자열로 바꿉니다.
 * @returns {Promise<{mimeType: string, base64: string, name: string}>}
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve({
        mimeType: file.type,
        base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
        name: file.name,
      });
    };
    reader.onerror = () => reject(new AIError(`파일을 읽지 못했습니다: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * AI가 ```json 같은 코드블록으로 감싸서 보내도 벗겨 냅니다.
 */
export function stripCodeFence(text) {
  return String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

/** 응답 본문에서 오류 메시지를 꺼냅니다. 형식이 달라도 안전하게 동작합니다. */
function readErrorDetail(data) {
  return data?.error?.message || '';
}

/**
 * HTTP 상태 코드를 사용자에게 보여 줄 문장으로 바꿉니다.
 * 명세서 7.2 기준입니다.
 */
function toAIError(status, detail, provider) {
  const hint = detail ? ` (상세: ${detail})` : '';

  // Gemini는 잘못된 키에 대해 400을 보내기도 하므로 메시지 내용도 함께 확인합니다.
  const isKeyProblem =
    status === 401 || status === 403 || (status === 400 && /api key/i.test(detail));

  if (isKeyProblem) {
    return new AIError(`API 키가 올바르지 않습니다. 설정에서 확인하세요.${hint}`, { status, provider });
  }
  if (status === 404) {
    return new AIError(`선택한 모델을 찾을 수 없습니다. 설정에서 다른 모델을 고르세요.${hint}`, { status, provider });
  }
  if (status === 429) {
    const reset = provider === 'gemini' ? ' Gemini는 한국 시간 오후 4~5시쯤 초기화됩니다.' : '';
    return new AIError(`오늘 사용 한도를 넘었습니다.${reset} 다른 모델이나 제공자로 바꿔 보세요.${hint}`, { status, provider });
  }
  return new AIError(`AI 서버 오류가 발생했습니다 (${status}).${hint}`, { status, provider });
}

/**
 * fetch를 호출하고, 네트워크 오류나 5xx 응답이면 지수 백오프로 최대 2회 재시도합니다.
 */
async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try {
      res = await fetch(url, options);
    } catch {
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new AIError('네트워크 연결에 실패했습니다. 인터넷 연결을 확인하세요.');
    }

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    return res;
  }
}

/**
 * Gemini generateContent를 호출하고 응답 글자만 돌려줍니다.
 * @param {object} opt
 * @param {string} opt.model - 예: gemini-2.5-flash
 * @param {string} opt.apiKey
 * @param {string} [opt.system] - 시스템 지시문
 * @param {string} opt.userText - 사용자 입력 글
 * @param {Array} [opt.files] - fileToBase64()의 결과 배열
 * @param {boolean} [opt.json] - true면 JSON 형식 응답을 강제합니다.
 */
async function callGemini({ model, apiKey, system = '', userText, files = [], json = true }) {
  const parts = files.map((f) => ({
    inline_data: { mime_type: f.mimeType, data: f.base64 },
  }));
  parts.push({ text: userText });

  const body = {
    contents: [{ role: 'user', parts }],
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  if (json) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }

  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw toAIError(res.status, readErrorDetail(data), 'gemini');
  }

  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) {
    throw new AIError('AI 응답이 비어 있습니다. 다시 시도하세요.', { provider: 'gemini' });
  }
  return text;
}

/**
 * 설정 탭의 "연결 테스트" 버튼이 호출합니다.
 * 짧은 질문을 보내 응답이 오는지만 확인합니다.
 * @returns {Promise<string>} AI가 보낸 짧은 답변
 */
export async function testConnection({ provider, apiKey, model }) {
  if (!apiKey) {
    throw new AIError('API 키를 먼저 입력하세요. 입력 후 칸 밖을 한 번 클릭해야 저장됩니다.');
  }

  if (provider === 'gemini') {
    const text = await callGemini({
      model,
      apiKey,
      userText: 'Reply with only the word OK.',
      json: false,
    });
    return text.slice(0, 100);
  }

  throw new AIError('Claude 연결은 다음 단계에서 추가됩니다.');
}

/**
 * 앱의 다른 탭이 쓰는 공통 호출 함수입니다.
 * 현재 설정된 제공자와 단계별 모델을 골라 요청합니다.
 * @param {object} opt
 * @param {'analyze'|'generate'|'verify'} opt.stage - 단계에 맞는 모델이 선택됩니다.
 * @param {string} [opt.system] - 시스템 지시문
 * @param {string} opt.userText - 사용자 입력 글
 * @param {Array} [opt.files] - fileToBase64()로 바꾼 파일 목록
 * @param {boolean} [opt.json] - 기본값 true
 * @returns {Promise<string>} AI 응답 글자
 */
export async function callAI({ stage, system, userText, files = [], json = true }) {
  const settings = (await getSettings()) || {};
  const provider = settings.provider || 'gemini';
  const model = settings.models?.[provider]?.[stage];
  const apiKey = await getApiKey();

  if (!apiKey) {
    throw new AIError('API 키가 없습니다. 설정 탭에서 키를 입력하세요.', { provider });
  }
  if (!model) {
    throw new AIError('선택된 모델이 없습니다. 설정 탭에서 모델을 고르세요.', { provider });
  }

  if (provider === 'gemini') {
    return callGemini({ model, apiKey, system, userText, files, json });
  }

  throw new AIError('Claude 호출은 다음 단계에서 추가됩니다.', { provider });
}
/**
 * AI 응답 글자를 JSON 객체로 바꿉니다. 실패하면 null을 돌려줍니다.
 */
export function parseJSONSafe(text) {
  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
}

/**
 * JSON 응답을 기대하는 호출입니다.
 * 파싱에 실패하면 1회 더 요청하고, 그래도 실패하면 AI 원문을 담은 오류를 던집니다.
 * @param {object} opt - callAI()와 같은 옵션
 * @returns {Promise<object>} 파싱된 JSON 객체
 */
export async function callAIJson(opt) {
  let lastText = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    lastText = await callAI({ ...opt, json: true });
    const parsed = parseJSONSafe(lastText);
    if (parsed !== null) return parsed;
  }

  const err = new AIError('AI 응답을 JSON으로 읽지 못했습니다. 다시 시도하세요.');
  err.raw = lastText; // 화면에서 원문을 보여 줄 때 사용합니다.
  throw err;
}
