export type PromptMap = Record<string, string>;

const STORAGE_KEY_NEW = 'contextsync_prompts';
const STORAGE_KEY_LEGACY = 'promptMap';

function normalizeKey(k: string) {
  return k.normalize('NFC').trim();
}

function mergePromptMaps(newMap: PromptMap, legacyMap: PromptMap): PromptMap {
  return { ...legacyMap, ...newMap };
}

export async function getAllPrompts(): Promise<PromptMap> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_NEW, STORAGE_KEY_LEGACY], (res) => {
      const rawNew = (res[STORAGE_KEY_NEW] || {}) as PromptMap;
      const rawLegacy = (res[STORAGE_KEY_LEGACY] || {}) as PromptMap;
      resolve(mergePromptMaps(rawNew, rawLegacy));
    });
  });
}

export async function savePrompts(map: PromptMap): Promise<void> {
  return new Promise((resolve, reject) => {
    const normalized: PromptMap = {};
    for (const k of Object.keys(map)) {
      normalized[normalizeKey(k)] = map[k];
    }
    chrome.storage.local.set(
      {
        [STORAGE_KEY_NEW]: normalized,
        [STORAGE_KEY_LEGACY]: normalized
      },
      () => {
        const err = chrome.runtime.lastError;
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

export function subscribeToChanges(cb: (map: PromptMap) => void) {
  const bc = new BroadcastChannel('contextsync_prompts');
  bc.onmessage = () => getAllPrompts().then(cb).catch(() => {});

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY_NEW] || changes[STORAGE_KEY_LEGACY]) {
      getAllPrompts().then(cb).catch(() => {});
    }
  });

  return () => {
    bc.close();
    // no removal API for chrome.storage.onChanged in MV3
  };
}

export function broadcastChange() {
  try {
    const bc = new BroadcastChannel('contextsync_prompts');
    bc.postMessage('update');
    bc.close();
  } catch (e) {
    // ignore
  }
}

// Hidden prompts + password handling
const STORAGE_KEY_HIDDEN = 'hidden_prompts';
const STORAGE_KEY_HIDDEN_PASSWORD = 'hidden_prompts_password_hash';

export async function getHiddenPrompts(): Promise<PromptMap> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_HIDDEN], (res) => {
      resolve((res[STORAGE_KEY_HIDDEN] || {}) as PromptMap);
    });
  });
}

export async function saveHiddenPrompts(map: PromptMap): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_HIDDEN]: map }, () => resolve());
  });
}

export async function getHiddenPasswordHash(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_HIDDEN_PASSWORD], (res) => {
      resolve((res[STORAGE_KEY_HIDDEN_PASSWORD] as string) || null);
    });
  });
}

export async function setHiddenPasswordHash(hash: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_HIDDEN_PASSWORD]: hash }, () => resolve());
  });
}

// Move a prompt from main store to hidden store
export async function movePromptToHidden(key: string): Promise<void> {
  const all = await getAllPrompts();
  const hidden = await getHiddenPrompts();
  if (all[key] !== undefined) {
    hidden[key] = all[key];
    delete all[key];
    await savePrompts(all);
    await saveHiddenPrompts(hidden);
    broadcastChange();
  }
}

export async function movePromptToVisible(key: string): Promise<void> {
  const all = await getAllPrompts();
  const hidden = await getHiddenPrompts();
  if (hidden[key] !== undefined) {
    all[key] = hidden[key];
    delete hidden[key];
    await savePrompts(all);
    await saveHiddenPrompts(hidden);
    broadcastChange();
  }
}
