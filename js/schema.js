// js/schema.js
// 영어 유형 목록, 카드·설계도·생성 문항의 검증 함수, 요약 계산 함수를 담당합니다.
// 이 파일은 AI를 호출하지 않으며 인터넷 연결이 필요 없습니다.

/** 영어 유형 목록입니다. 명세서 4.1과 같습니다. */
export const TYPES = [
  { code: 'TOPIC', name: '주제', format: 'MC' },
  { code: 'TITLE', name: '제목', format: 'MC' },
  { code: 'GIST', name: '요지·주장', format: 'MC' },
  { code: 'PURPOSE', name: '글의 목적', format: 'MC' },
  { code: 'MOOD', name: '심경·분위기', format: 'MC' },
  { code: 'IMPLY', name: '함축 의미 추론', format: 'MC' },
  { code: 'REFER', name: '지칭 대상', format: 'MC' },
  { code: 'DETAIL', name: '내용 일치·불일치', format: 'MC' },
  { code: 'GRAMMAR', name: '어법', format: 'MC' },
  { code: 'VOCAB', name: '어휘', format: 'MC' },
  { code: 'BLANK', name: '빈칸 추론', format: 'MC' },
  { code: 'IRRELEVANT', name: '무관한 문장', format: 'MC' },
  { code: 'ORDER', name: '글의 순서', format: 'MC' },
  { code: 'INSERT', name: '문장 삽입', format: 'MC' },
  { code: 'SUMMARY', name: '요약문 완성', format: 'MC' },
  { code: 'CHART', name: '도표', format: 'MC' },
  { code: 'W_CONDITION', name: '조건 영작', format: 'WR' },
  { code: 'W_ARRANGE', name: '어순 배열', format: 'WR' },
  { code: 'W_BLANK', name: '빈칸 쓰기', format: 'WR' },
  { code: 'W_CORRECT', name: '어법 오류 수정', format: 'WR' },
  { code: 'W_SUMMARY', name: '요약문 쓰기', format: 'WR' },
  { code: 'W_ANSWER', name: '영어 질문에 답하기', format: 'WR' },
  { code: 'W_TRANSFORM', name: '문장 전환', format: 'WR' },
  { code: 'W_TRANSLATE', name: '우리말 해석·영작', format: 'WR' },
  { code: 'ETC', name: '기타', format: null },
];

export const TYPE_MAP = Object.fromEntries(TYPES.map((t) => [t.code, t]));
export const TYPE_CODES = TYPES.map((t) => t.code);
export const FORMATS = ['MC', 'WR'];
export const SOURCES = ['TEXTBOOK', 'MOCK', 'SUPPLEMENT', 'EXTERNAL', 'UNKNOWN'];
export const GRADES = ['중1', '중2', '중3', '고1', '고2', '고3'];
export const EXAM_NAMES = ['1학기 중간', '1학기 기말', '2학기 중간', '2학기 기말'];
export const CIRCLED = ['①', '②', '③', '④', '⑤'];

/** 유형 코드를 한글 이름으로 바꿉니다. 모르는 코드는 그대로 돌려줍니다. */
export function typeLabel(code) {
  return TYPE_MAP[code] ? TYPE_MAP[code].name : code;
}

/**
 * AI가 빠뜨린 값에 기본값을 채워 넣습니다.
 * 검증 전에 한 번 거치면 실패가 줄어듭니다.
 */
export function normalizeCard(card) {
  const c = { ...card };
  if (c.score === undefined) c.score = null;
  if (c.source === undefined) c.source = 'UNKNOWN';
  if (c.choices === undefined) c.choices = null;
  if (c.visual === undefined) c.visual = '';
  if (c.note === undefined) c.note = '';
  if (c.originalText === undefined) c.originalText = '';
  if (c.stemPattern === undefined) c.stemPattern = '';
  if (c.point === undefined) c.point = '';
  return c;
}

/**
 * 유형 카드 하나를 검사합니다.
 * @returns {string[]} 오류 문장 목록. 비어 있으면 정상입니다.
 */
export function validateCard(card) {
  if (!card || typeof card !== 'object') {
    return ['카드 형식이 아닙니다.'];
  }

  const errors = [];

  if (!Number.isInteger(card.no) || card.no < 1) {
    errors.push('문항 번호(no)는 1 이상의 정수여야 합니다.');
  }
  if (!FORMATS.includes(card.format)) {
    errors.push(`형식(format)은 MC 또는 WR이어야 합니다: ${card.format}`);
  }
  if (!TYPE_MAP[card.type]) {
    errors.push(`알 수 없는 유형(type)입니다: ${card.type}`);
  } else if (TYPE_MAP[card.type].format && TYPE_MAP[card.type].format !== card.format) {
    errors.push(`유형 ${card.type}은 ${TYPE_MAP[card.type].format} 형식이어야 합니다.`);
  }
  if (!Number.isInteger(card.difficulty) || card.difficulty < 1 || card.difficulty > 5) {
    errors.push('난이도(difficulty)는 1~5 사이의 정수여야 합니다.');
  }
  if (card.score !== null && card.score !== undefined) {
    if (typeof card.score !== 'number' || card.score < 0) {
      errors.push('배점(score)은 0 이상의 숫자 또는 null이어야 합니다.');
    }
  }
  if (!SOURCES.includes(card.source)) {
    errors.push(`출처(source)가 올바르지 않습니다: ${card.source}`);
  }

  return errors;
}

/**
 * 기출 설계도 전체를 검사합니다.
 * 카드별 오류는 "문항 n: ..." 형태로 앞에 번호를 붙여 돌려줍니다.
 * @returns {string[]} 오류 문장 목록
 */
export function validateBlueprint(bp) {
  if (!bp || typeof bp !== 'object') {
    return ['설계도 형식이 아닙니다.'];
  }

  const errors = [];

  if (typeof bp.school !== 'string' || bp.school.trim() === '') {
    errors.push('학교명(school)을 입력하세요.');
  }
  if (!GRADES.includes(bp.grade)) {
    errors.push(`학년(grade)이 올바르지 않습니다: ${bp.grade}`);
  }
  if (!EXAM_NAMES.includes(bp.exam)) {
    errors.push(`시험(exam)이 올바르지 않습니다: ${bp.exam}`);
  }
  if (!Number.isInteger(bp.year) || bp.year < 2000 || bp.year > 2100) {
    errors.push(`연도(year)가 올바르지 않습니다: ${bp.year}`);
  }
  if (!Array.isArray(bp.cards) || bp.cards.length === 0) {
    errors.push('유형 카드(cards)가 한 개 이상 있어야 합니다.');
    return errors;
  }

  const seen = new Set();
  bp.cards.forEach((card) => {
    validateCard(card).forEach((msg) => errors.push(`문항 ${card?.no ?? '?'}: ${msg}`));
    if (seen.has(card?.no)) {
      errors.push(`문항 번호가 중복되었습니다: ${card?.no}`);
    }
    seen.add(card?.no);
  });

  return errors;
}

/**
 * 카드 목록으로 요약 정보를 계산합니다.
 * 기출 분석 탭에서 카드를 고칠 때마다 다시 계산해 보여 줍니다.
 */
export function buildSummary(cards) {
  const typeRatio = {};
  let mcCount = 0;
  let wrCount = 0;
  let diffSum = 0;
  let diffCount = 0;

  cards.forEach((card) => {
    if (card.format === 'MC') mcCount++;
    if (card.format === 'WR') wrCount++;
    if (card.type) typeRatio[card.type] = (typeRatio[card.type] || 0) + 1;
    if (Number.isInteger(card.difficulty)) {
      diffSum += card.difficulty;
      diffCount++;
    }
  });

  return {
    totalItems: cards.length,
    mcCount,
    wrCount,
    typeRatio,
    avgDifficulty: diffCount ? Math.round((diffSum / diffCount) * 10) / 10 : 0,
    trendNote: '',
  };
}

/**
 * AI가 만든 변형 문항 하나를 검사합니다.
 * 객관식은 선택지 5개와 ①~⑤ 정답이 필요하고, 서술형은 모범답안 글이 필요합니다.
 * @returns {string[]} 오류 문장 목록
 */
export function validateItem(item) {
  if (!item || typeof item !== 'object') {
    return ['문항 형식이 아닙니다.'];
  }

  const errors = [];

  if (!TYPE_MAP[item.type]) {
    errors.push(`알 수 없는 유형(type)입니다: ${item.type}`);
  }
  if (!FORMATS.includes(item.format)) {
    errors.push(`형식(format)은 MC 또는 WR이어야 합니다: ${item.format}`);
  }
  if (typeof item.stem !== 'string' || item.stem.trim() === '') {
    errors.push('발문(stem)이 비어 있습니다.');
  }
  if (typeof item.body !== 'string') {
    errors.push('지문 본문(body)은 글자여야 합니다.');
  }
  if (typeof item.explanation !== 'string' || item.explanation.trim() === '') {
    errors.push('해설(explanation)이 비어 있습니다.');
  }
  if (!Number.isInteger(item.difficulty) || item.difficulty < 1 || item.difficulty > 5) {
    errors.push('난이도(difficulty)는 1~5 사이의 정수여야 합니다.');
  }

  if (item.format === 'MC') {
    if (!Array.isArray(item.choices) || item.choices.length !== 5) {
      errors.push('객관식은 선택지가 정확히 5개여야 합니다.');
    }
    if (!CIRCLED.includes(item.answer)) {
      errors.push(`객관식 정답은 ①~⑤ 중 하나여야 합니다: ${item.answer}`);
    }
  }
  if (item.format === 'WR') {
    if (typeof item.answer !== 'string' || item.answer.trim() === '') {
      errors.push('서술형은 모범답안(answer)이 필요합니다.');
    }
  }

  return errors;
}
