// js/prompts.js
// 기출 분석, 변형문제 생성, 재생성, 검산용 프롬프트를 만듭니다.
// 기출 원문은 분석 결과로도 받지 않으며, 생성 단계에는 설계도 필드만 보냅니다.

import { TYPES, CIRCLED } from './schema.js';

const TYPE_LIST_TEXT = TYPES
  .map((t) => `${t.code}(${t.name}${t.format ? ', ' + t.format : ''})`)
  .join(', ');

const JSON_ONLY =
  '출력은 JSON 객체 하나만 쓰세요. 설명문, 마크다운, 코드블록(```)을 붙이지 마세요.';
const KOREAN_EXAM =
  '해설은 한국어로 쓰고, 문제는 한국 내신 시험 형식(한국어 발문 + 영어 지문)으로 작성하세요.';

/** 영어 지문의 단어 수를 셉니다. 공백 기준으로 나눕니다. */
function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * 기출 분석용 프롬프트입니다. 시험지 파일은 callAI의 files로 함께 보냅니다.
 * 기출 원문(발문, 선택지, 지문)은 결과에 담지 않고, 일반화한 패턴만 받습니다.
 * @param {{school: string, grade: string, exam: string, year: number}} meta
 * @returns {{system: string, userText: string}}
 */
export function buildAnalysisPrompt(meta) {
  const system = [
    '당신은 한국 중·고등학교 영어 내신 시험 분석 전문가입니다.',
    '첨부된 기출 시험지의 모든 문항을 분석하여 아래 형식의 JSON으로만 출력하세요.',
    '',
    '규칙:',
    `- type은 반드시 다음 코드 중 하나: ${TYPE_LIST_TEXT}`,
    '- 목록에 맞는 유형이 없으면 type을 ETC로 쓰고 note에 설명하세요.',
    '- format은 MC(객관식) 또는 WR(서술형)입니다.',
    '- stemPattern은 발문을 일반화한 형태로 쓰세요. 고유명사와 구체 내용은 지웁니다.',
    '- point는 해당 문항이 평가하는 핵심(문법 항목, 독해 기술 등)을 짧게 쓰세요.',
    '- difficulty는 1~5 정수입니다. 지문 난도, 선택지 매력도, 추론 단계를 근거로 판단하세요.',
    '- source는 TEXTBOOK, MOCK, SUPPLEMENT, EXTERNAL, UNKNOWN 중 하나입니다.',
    '- choices는 객관식 선택지 개수, visual은 밑줄이나 도표 같은 시각 요소 설명입니다. 없으면 빈 문자열입니다.',
    '- 발문, 선택지, 지문 본문의 문장을 그대로 옮기지 마세요. 문항의 구조와 유형만 설명하세요.',
    '- 배점이 보이지 않으면 score는 null입니다.',
    '- summary.trendNote에는 출제 경향을 2~3문장으로 쓰세요.',
    '',
    '출력 형식:',
    '{ "cards": [ { "no": 1, "format": "MC", "type": "GRAMMAR", "stemPattern": "...", "point": "...", "difficulty": 3, "score": 4.0, "source": "TEXTBOOK", "choices": 5, "visual": "", "note": "" } ], "summary": { "trendNote": "..." } }',
    '',
    JSON_ONLY,
  ].join('\n');

  const userText = [
    `학교: ${meta.school}`,
    `학년: ${meta.grade}`,
    `시험: ${meta.year}년 ${meta.exam}`,
    '',
    '첨부된 시험지의 모든 문항을 번호 순서대로 분석하세요.',
  ].join('\n');

  return { system, userText };
}

/** 설계도 카드에서 생성에 필요한 필드만 골라냅니다. */
function toPlan(card) {
  return {
    no: card.no,
    type: card.type,
    format: card.format,
    stemPattern: card.stemPattern || '',
    point: card.point || '',
    difficulty: card.difficulty,
    score: card.score ?? null,
  };
}

/**
 * 한 지문에 배정된 카드들로 변형문제를 만드는 프롬프트입니다.
 * 지문 길이를 단어 수로 지정해, 문항 번호가 뒤로 갈수록 본문이 짧아지지 않게 합니다.
 * @param {{title: string, text: string}} passage
 * @param {Array} cards - 이 지문에 배정된 설계도 카드 목록
 * @returns {{system: string, userText: string}}
 */
export function buildGeneratePrompt({ passage, cards }) {
  const target = countWords(passage.text);
  const minWords = Math.max(1, Math.round(target * 0.9));
  const maxWords = Math.round(target * 1.1);

  const system = [
    '당신은 한국 영어 내신 출제 교사입니다.',
    '아래 [출제 설계]에 맞춰 [지문]으로 새 문항을 만드세요.',
    '',
    '규칙:',
    '- 기존 시험 문항을 재현하지 말고 완전히 새로 출제하세요.',
    '- 정답은 반드시 하나이며, 오답 선택지는 그럴듯하되 명확히 틀려야 합니다.',
    '- 객관식의 선택지는 정확히 5개이며, 각 선택지는 ①~⑤ 기호로 시작합니다.',
    '- 객관식 answer는 ①~⑤ 중 하나의 기호만 씁니다.',
    '- 어법 문항: 밑줄은 <u>①단어</u> 형식으로 표시하고, 틀린 것은 정확히 하나(또는 지시된 개수)입니다.',
    '- 빈칸 문항: 빈칸은 ________ 로 표시하고, 정답 근거가 지문 안에 있어야 합니다.',
    '- 순서·삽입 문항: 지문을 (A)(B)(C) 또는 ①~⑤ 위치로 재구성하세요.',
    '- 서술형: 조건을 <조건>으로 명시하고, 모범답안을 answer에, 채점 기준을 explanation에 넣으세요.',
    '- 해설에는 정답 근거를 지문에서 인용하여 설명하세요.',
    `- ${KOREAN_EXAM}`,
    '- 출제 설계의 items 배열 순서와 번호(no)를 그대로 지키세요. 항목 수를 바꾸지 마세요.',
    '',
    '[지문 길이 규칙 - 가장 중요]',
    `- 참고 지문의 영어 단어 수는 약 ${target}단어입니다.`,
    `- 모든 문항의 body(본문)는 ${minWords}~${maxWords}단어 범위여야 합니다.`,
    '- 문항 번호가 뒤로 갈수록 지문이 짧아지면 안 됩니다. 몇 번 문항이든 같은 분량을 유지하세요.',
    '- 어법, 빈칸, 순서, 삽입, 서술형 등 어떤 유형이든 예외는 없습니다. 충분한 길이의 본문을 먼저 쓰고 그 안에서 문항을 만드세요.',
    '- 지문을 여러 조각으로 나누더라도 body 전체의 단어 수는 위 범위를 지켜야 합니다.',
    '- 출력하기 전에 각 문항의 body 단어 수를 직접 세고, 범위를 벗어나면 다시 작성하세요.',
    '',
    '출력 형식:',
    '{ "items": [ { "no": 1, "type": "GRAMMAR", "format": "MC", "stem": "발문", "body": "변형 지문", "choices": ["①...", "②...", "③...", "④...", "⑤..."], "answer": "③", "explanation": "해설", "difficulty": 3, "score": 4.0 } ] }',
    '- 서술형 문항은 choices를 빈 배열로 두세요.',
    '',
    JSON_ONLY,
  ].join('\n');

  const plan = cards.map(toPlan);
  const userText = [
    '[출제 설계]',
    JSON.stringify({ items: plan }, null, 2),
    '',
    '[지문]',
    `제목: ${passage.title}`,
    passage.text,
  ].join('\n');

  return { system, userText };
}

const MODE_INSTRUCTIONS = {
  same: '같은 유형과 난이도를 유지하되, 지문 내용과 선택지를 새로 구성해 다시 출제하세요.',
  easier: '난이도를 한 단계 낮춰 다시 출제하세요. 선택지의 차이를 분명하게 만드세요.',
  harder: '난이도를 한 단계 높여 다시 출제하세요. 추론 단계를 늘리고 오답의 매력도를 높이세요.',
};

/**
 * 문항 하나를 다시 만드는 프롬프트입니다. 다시 생성, 더 쉽게, 더 어렵게에 씁니다.
 * @param {object} opt
 * @param {{title: string, text: string}} opt.passage
 * @param {object} opt.item - 현재 문항(생성된 문항 JSON)
 * @param {'same'|'easier'|'harder'} opt.mode
 * @returns {{system: string, userText: string}}
 */
export function buildRegeneratePrompt({ passage, item, mode = 'same' }) {
  const system = [
    '당신은 한국 영어 내신 출제 교사입니다.',
    '아래 [현재 문항]을 [지시]에 따라 다시 출제하세요.',
    '',
    '규칙:',
    '- 기존 문항을 그대로 베끼지 말고 새로 작성하세요.',
    '- 정답은 하나이며, 객관식 선택지는 정확히 5개이고 ①~⑤ 기호로 시작합니다.',
    '- 같은 지문 내용을 쓰되, 정답 근거는 지문 안에 있어야 합니다.',
    '- body(본문)의 길이는 현재 문항과 비슷하게 유지하세요. 짧게 줄이지 마세요.',
    `- ${KOREAN_EXAM}`,
    '',
    '출력 형식:',
    '{ "item": { "no": 1, "type": "GRAMMAR", "format": "MC", "stem": "발문", "body": "변형 지문", "choices": ["①...", "②...", "③...", "④...", "⑤..."], "answer": "③", "explanation": "해설", "difficulty": 3, "score": 4.0 } }',
    '',
    JSON_ONLY,
  ].join('\n');

  const pick = (x) => ({
    no: x.no,
    type: x.type,
    format: x.format,
    stem: x.stem,
    body: x.body,
    choices: x.choices,
    answer: x.answer,
    explanation: x.explanation,
    difficulty: x.difficulty,
    score: x.score ?? null,
  });

  const userText = [
    '[지시]',
    MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.same,
    '',
    '[현재 문항]',
    JSON.stringify(pick(item), null, 2),
    '',
    '[지문]',
    `제목: ${passage.title}`,
    passage.text,
  ].join('\n');

  return { system, userText };
}

/**
 * 검산용 프롬프트입니다. 정답과 해설은 보내지 않습니다.
 * AI가 문제만 보고 풀게 해서 정답이 우연히 맞는지 확인합니다.
 * @param {object} item - 생성된 문항
 * @returns {{system: string, userText: string}}
 */
export function buildVerifyPrompt(item) {
  const system = [
    '다음 영어 문항을 풀고 정답과 근거를 JSON으로만 출력하세요.',
    '정답이 둘 이상이거나 정답이 없으면 issue에 설명하세요. 문제가 없으면 issue는 빈 문자열입니다.',
    '',
    '출력 형식:',
    '{ "answer": "③", "reason": "...", "issue": "" }',
    '서술형 문항이라면 answer에 예상 답안 글을 씁니다.',
    '',
    JSON_ONLY,
  ].join('\n');

  const lines = [];
  lines.push(`형식: ${item.format === 'MC' ? '객관식' : '서술형'}`);
  lines.push(`발문: ${item.stem}`);
  lines.push('');
  lines.push(item.body);
  if (item.format === 'MC' && Array.isArray(item.choices)) {
    lines.push('');
    lines.push(...item.choices);
  }

  return { system, userText: lines.join('\n') };
}

/**
 * 검산 결과를 원래 정답과 비교해 상태를 정합니다.
 * @returns {{status: 'PASS'|'FAIL'|'PENDING', note: string}}
 */
export function compareVerify(item, result) {
  if (!result || typeof result !== 'object') {
    return { status: 'FAIL', note: '검산 응답을 읽지 못했습니다.' };
  }

  if (item.format === 'WR') {
    return {
      status: 'PENDING',
      note: '서술형은 자동 비교가 어렵습니다. 예상 답안을 직접 확인하세요.',
    };
  }

  const found = String(result.answer || '').match(/[①②③④⑤]/);
  const answer = found ? found[0] : '';
  const issue = String(result.issue || '').trim();

  if (issue) {
    return { status: 'FAIL', note: `검산 문제 지적: ${issue}` };
  }
  if (answer !== item.answer) {
    return {
      status: 'FAIL',
      note: `검산 답(${answer || '없음'})이 원래 정답(${item.answer})과 다릅니다.`,
    };
  }
  return { status: 'PASS', note: '' };
}
