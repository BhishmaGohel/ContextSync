import React, { useEffect, useState } from 'react';
import { getAllPrompts, PromptMap, subscribeToChanges } from '@shared/storage';

export default function PopupApp() {
  const [prompts, setPrompts] = useState<PromptMap>({});

  useEffect(() => {
    getAllPrompts().then(setPrompts).catch(() => {});
    const unsub = subscribeToChanges(setPrompts);
    return unsub;
  }, []);

  return (
    <div className="p-4 w-80">
      <div className="mb-3 flex justify-between items-center">
        <h1 className="text-lg font-semibold">ContextSync</h1>
        <button
          className="button-secondary px-2 py-1 rounded"
          onClick={() => {
            try {
              if (chrome.runtime && chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
              } else {
                const url = chrome.runtime.getURL('dashboard.html');
                chrome.tabs.create({ url });
              }
            } catch (e) {
              const url = (chrome && chrome.runtime && chrome.runtime.getURL)
                ? chrome.runtime.getURL('dashboard.html')
                : '/dashboard.html';
              window.open(url, '_blank');
            }
          }}
        >
          Dashboard
        </button>
      </div>
      <div className="space-y-2">
        {Object.keys(prompts).length === 0 && <div className="text-sm text-gray-500">No prompts saved.</div>}
        {Object.entries(prompts).map(([k, v]) => (
          <div key={k} className="p-2 border rounded">
            <div className="font-medium">{k}</div>
            <div className="text-sm text-gray-700 truncate">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
