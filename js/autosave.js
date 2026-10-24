// js/autosave.js
// 파일 저장 도우미: 백업은 "다른 이름으로 저장" 창으로 폴더와 이름을 고르고, 설계도는 다운로드 폴더에 자동 저장합니다.

/** "다른 이름으로 저장" 창을 쓸 수 있는 브라우저(Chrome, Edge)인지 확인합니다. */
export function isSavePickerSupported() {
  return typeof window.showSaveFilePicker === 'function';
}

/** 브라우저 기본 다운로드 기능으로 파일을 내려받습니다. */
function downloadFile(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 파일을 저장합니다. 저장 창을 쓸 수 있으면 폴더와 파일 이름을 사용자가 고르게 합니다.
 * 저장한 파일 이름을 돌려주고, 사용자가 창을 닫으면 null을 돌려줍니다.
 * 저장 창을 쓸 수 없으면 다운로드 폴더에 바로 저장합니다.
 */
export async function saveFileWithDialog(text, suggestedName) {
  if (isSavePickerSupported()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        startIn: 'downloads',
        types: [{ description: 'JSON 파일', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return handle.name;
    } catch (err) {
      if (err.name === 'AbortError') return null; // 사용자가 창을 닫음
      console.warn('저장 창 사용 실패, 다운로드 방식으로 저장합니다:', err);
    }
  }
  downloadFile(suggestedName, text);
  return suggestedName;
}

/** 파일 이름에 쓸 수 없는 글자와 공백을 밑줄로 바꿉니다. */
function safeName(text) {
  return String(text ?? '').replace(/[\\/:*?"<>|\s]+/g, '_');
}

/** 설계도 객체를 JSON 파일로 다운로드 폴더에 저장합니다. analyze.js가 사용합니다. */
export async function autoSaveBlueprint(bp) {
  const name = `${safeName(bp.school)}_${safeName(bp.grade)}_${safeName(bp.exam)}_${bp.year}.json`;
  downloadFile(name, JSON.stringify(bp, null, 2));
  return name;
}
