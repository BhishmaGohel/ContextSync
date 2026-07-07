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
