// js/db.js
// IndexedDB 래퍼: 저장소 CRUD, 백업 내보내기·불러오기, 전체 삭제를 담당합니다.

const DB_NAME = 'exam-maker';
const DB_VERSION = 1;

// settings는 키 'main' 하나만 쓰고, 나머지 저장소는 각 객체의 id를 키로 씁니다.
const STORE_NAMES = ['settings', 'blueprints', 'passages', 'sets'];
const KEYED_STORES = ['blueprints', 'passages', 'sets'];
const SETTINGS_KEY = 'main';

const BACKUP_APP_ID = 'exam-maker';
const BACKUP_VERSION = 1;
// 백업 파일에 넣지 않을 설정 항목입니다.
const SECRET_FIELDS = ['apiKey'];

let dbPromise = null;

/**
 * 데이터베이스를 엽니다. 처음 열 때 저장소를 만들고, 이후에는 같은 연결을 재사용합니다.
 */
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        KEYED_STORES.forEach((name) => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        });
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

function assertStore(storeName) {
  if (!STORE_NAMES.includes(storeName)) {
    throw new Error(`알 수 없는 저장소입니다: ${storeName}`);
  }
}

/**
 * 트랜잭션 하나를 열어 요청을 실행하고, 커밋이 끝나면 결과를 돌려줍니다.
 */
async function runRequest(storeName, mode, action) {
  assertStore(storeName);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 저장소에서 키 하나로 항목을 읽습니다. */
export function getItem(storeName, key) {
  return runRequest(storeName, 'readonly', (store) => store.get(key));
}

/** 저장소의 모든 항목을 배열로 읽습니다. */
export function getAll(storeName) {
  return runRequest(storeName, 'readonly', (store) => store.getAll());
}

/**
 * 항목을 저장합니다(있으면 덮어씀).
 * key를 넘기면 설정처럼 키를 직접 지정합니다.
 * key를 넘기지 않으면 id를 자동으로 만들어 넣습니다.
 */
export function putItem(storeName, value, key) {
  if (key === undefined && KEYED_STORES.includes(storeName) && !value.id) {
    value.id = crypto.randomUUID();
  }
  return runRequest(storeName, 'readwrite', (store) =>
    key === undefined ? store.put(value) : store.put(value, key)
  );
}

/** 항목 하나를 삭제합니다. */
export function deleteItem(storeName, key) {
  return runRequest(storeName, 'readwrite', (store) => store.delete(key));
}

/** 저장소 하나를 비웁니다. */
export function clearStore(storeName) {
  return runRequest(storeName, 'readwrite', (store) => store.clear());
}

/** 설정(키 'main')을 읽습니다. 없으면 undefined입니다. */
export function getSettings() {
  return getItem('settings', SETTINGS_KEY);
}

/** 설정(키 'main')을 저장합니다. */
export function saveSettings(settings) {
  return putItem('settings', settings, SETTINGS_KEY);
}

/** 객체 복사본에서 비밀 항목(API 키 등)을 뺍니다. */
function stripSecrets(obj) {
  const copy = { ...obj };
  SECRET_FIELDS.forEach((field) => delete copy[field]);
  return copy;
}

/**
 * 전체 데이터를 백업용 객체로 만듭니다. API 키는 제외됩니다.
 */
export async function exportBackup() {
  const settings = await getSettings();
  return {
    app: BACKUP_APP_ID,
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      settings: settings ? stripSecrets(settings) : null,
      blueprints: await getAll('blueprints'),
      passages: await getAll('passages'),
      sets: await getAll('sets'),
    },
  };
}

/**
 * 백업을 JSON 파일로 내려받습니다.
 */
export async function downloadBackup() {
  const backup = await exportBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);

  const link = document.createElement('a');
  link.href = url;
  link.download = `exam-maker-backup-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 백업 파일을 읽어 현재 데이터를 교체합니다.
 * 백업에 없는 저장소는 건드리지 않습니다.
 * 현재 기기의 API 키는 백업으로 지워지지 않고 유지됩니다.
 * @param {File} file - input[type=file]에서 고른 JSON 파일
 * @returns {Promise<{blueprints: number, passages: number, sets: number}>}
 */
export async function importBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error('백업 파일을 읽을 수 없습니다. JSON 형식이 아닙니다.');
  }

  if (!backup || backup.app !== BACKUP_APP_ID || !backup.data) {
    throw new Error('이 앱에서 만든 백업 파일이 아닙니다.');
  }

  const { data } = backup;
  KEYED_STORES.forEach((name) => {
    if (data[name] !== undefined && !Array.isArray(data[name])) {
      throw new Error(`백업 형식이 올바르지 않습니다: ${name}`);
    }
    (data[name] || []).forEach((item) => {
      if (!item || !item.id) {
        throw new Error(`백업 항목에 id가 없습니다: ${name}`);
      }
    });
  });

  // 현재 기기에 저장된 API 키를 보존합니다.
  const current = await getSettings();
  const keptSecrets = {};
  SECRET_FIELDS.forEach((field) => {
    if (current && current[field] !== undefined) {
      keptSecrets[field] = current[field];
    }
  });

  const db = await openDB();
  const replaceStores = STORE_NAMES.filter((name) => data[name] !== undefined);

  await new Promise((resolve, reject) => {
    const tx = db.transaction(replaceStores, 'readwrite');
    replaceStores.forEach((name) => tx.objectStore(name).clear());

    if (data.settings) {
      tx.objectStore('settings').put(
        { ...data.settings, ...keptSecrets },
        SETTINGS_KEY
      );
    }
    KEYED_STORES.forEach((name) => {
      (data[name] || []).forEach((item) => tx.objectStore(name).put(item));
    });

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  return {
    blueprints: (data.blueprints || []).length,
    passages: (data.passages || []).length,
    sets: (data.sets || []).length,
  };
}

/**
 * 모든 저장소를 비웁니다(전체 삭제). 실행 전에 화면에서 확인을 받으세요.
 */
export async function clearAll() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAMES, 'readwrite');
    STORE_NAMES.forEach((name) => tx.objectStore(name).clear());
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
