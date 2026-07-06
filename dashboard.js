document.addEventListener('DOMContentLoaded', () => {
  const pName = document.getElementById('pName');
  const pText = document.getElementById('pText');
  const saveBtn = document.getElementById('saveBtn');
  const listContainer = document.getElementById('listContainer');

  // Core Storage Engine Wrapper (ACID-aligned atomic mutations on a single JSON tree key)
  const StorageEngine = {
    getAll: (callback) => {
      chrome.storage.local.get({ promptMap: {} }, (data) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.error('storage.get error:', chrome.runtime.lastError);
        }
        callback((data && data.promptMap) || {});
      });
    },
    save: (key, value, callback) => {
      chrome.storage.local.get({ promptMap: {} }, (data) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.error('storage.get error (save):', chrome.runtime.lastError);
        }
        const existing = (data && data.promptMap) || {};
        const updated = { ...existing, [key]: value };
        chrome.storage.local.set({ promptMap: updated }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.error('storage.set error:', chrome.runtime.lastError);
          } else {
            console.debug('Saved prompt:', key);
          }
          if (typeof callback === 'function') callback();
        });
      });
    },
    delete: (key, callback) => {
      chrome.storage.local.get({ promptMap: {} }, (data) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.error('storage.get error (delete):', chrome.runtime.lastError);
        }
        const updated = { ...((data && data.promptMap) || {}) };
        delete updated[key];
        chrome.storage.local.set({ promptMap: updated }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.error('storage.set error (delete):', chrome.runtime.lastError);
          }
          if (typeof callback === 'function') callback();
        });
      });
    }
  };

  const renderDashboard = () => {
    StorageEngine.getAll((prompts) => {
      listContainer.innerHTML = '';
      const keys = Object.keys(prompts);
      
      if (keys.length === 0) {
        listContainer.innerHTML = '<p style="color: #666;">No master prompts stored yet.</p>';
        return;
      }

      keys.forEach(key => {
        const card = document.createElement('div');
        card.className = 'prompt-card';

        const title = document.createElement('h3');
        title.textContent = key;

        const body = document.createElement('pre');
        body.textContent = prompts[key];

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'actions';

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.className = 'btn-delete';
        
        // Edge Case 2 Fix: Safe verification sequence check via native confirm block
        delBtn.addEventListener('click', () => {
          if (confirm(`Are you absolutely sure you want to delete the master prompt: "${key}"?`)) {
            StorageEngine.delete(key, renderDashboard);
          }
        });

        actionsDiv.appendChild(delBtn);
        card.appendChild(title);
        card.appendChild(body);
        card.appendChild(actionsDiv);
        listContainer.appendChild(card);
      });
    });
  };

  saveBtn.addEventListener('click', () => {
    const nameKey = pName.value.trim();
    // Preserve the prompt body exactly (do not trim) and normalize unicode
    const textValue = pText.value ? pText.value.normalize('NFC') : '';

    if (!nameKey) {
      alert('Error: Stored items cannot possess empty keys.');
      return;
    }
    if (!textValue) {
      alert('Error: Master prompt text cannot be empty.');
      return;
    }

    // Normalize key as well to avoid storage mismatches with Unicode keys
    const normalizedKey = nameKey.normalize ? nameKey.normalize('NFC') : nameKey;

    console.debug('Attempting save:', { key: normalizedKey, length: textValue.length });
    StorageEngine.save(normalizedKey, textValue, () => {
      // check storage after save
      chrome.storage.local.get({ promptMap: {} }, (data) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.error('post-save storage.get error:', chrome.runtime.lastError);
        }
        console.debug('post-save promptMap keys:', Object.keys((data && data.promptMap) || {}));
        pName.value = '';
        pText.value = '';
        renderDashboard();
      });
    });
  });

  // Export prompts as JSON file
  const exportBtn = document.getElementById('exportBtn');
  exportBtn.addEventListener('click', () => {
    StorageEngine.getAll((prompts) => {
      const blob = new Blob([JSON.stringify(prompts, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prompts.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  });

  // Import prompts from JSON file (merge, overwrite existing keys after confirmation)
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          alert('Invalid file format: expected an object of key->prompt mappings.');
          return;
        }

        const proceed = confirm('Import will merge prompts and overwrite any existing keys with the same name. Continue?');
        if (!proceed) return;

        // Normalize keys and values and merge into existing local storage
        StorageEngine.getAll((existing) => {
          const normalized = {};
          Object.keys(parsed).forEach(k => {
            const nk = k && k.normalize ? k.normalize('NFC') : k;
            const v = parsed[k] && parsed[k].normalize ? parsed[k].normalize('NFC') : parsed[k];
            normalized[nk] = String(v);
          });
          const merged = { ...(existing || {}), ...normalized };
          chrome.storage.local.set({ promptMap: merged }, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              console.error('import storage.set error:', chrome.runtime.lastError);
              alert('Import failed: ' + chrome.runtime.lastError.message);
              return;
            }
            renderDashboard();
            alert('Import successful.');
          });
        });

      } catch (err) {
        console.error('Failed to parse import file:', err);
        alert('Failed to parse JSON file.');
      }
    };
    reader.readAsText(f, 'utf-8');
    importFile.value = '';
  });

  renderDashboard();
});
