import { broadcastChange, getAllPrompts, savePrompts } from '@shared/storage';

function normalizeKey(key: string) {
  return key.normalize('NFC').trim();
}

let selectedKey: string | null = null;
let editing = false;

function clearSelectionUI() {
  selectedKey = null;
  editing = false;
  const pName = document.getElementById('pName') as HTMLInputElement;
  const pText = document.getElementById('pText') as HTMLTextAreaElement;
  pName.value = '';
  pText.value = '';
  pName.readOnly = false;
  pText.readOnly = false;
  toggleEditButtons();
}

function toggleEditButtons() {
  const updateBtn = document.getElementById('updateBtn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement;
  const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
  const pName = document.getElementById('pName') as HTMLInputElement;
  const pText = document.getElementById('pText') as HTMLTextAreaElement;

  if (selectedKey) {
    updateBtn.style.display = editing ? 'none' : 'inline-block';
    cancelBtn.style.display = editing ? 'inline-block' : 'none';
    // Save only enabled when editing; when creating new (no selectedKey) Save is enabled
    saveBtn.disabled = !editing;
    pName.readOnly = !editing;
    pText.readOnly = !editing;
  } else {
    // creating new prompt
    updateBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    saveBtn.disabled = false;
    pName.readOnly = false;
    pText.readOnly = false;
  }
}

function renderDashboard() {
  const listContainer = document.getElementById('listContainer')!;
  getAllPrompts().then((prompts) => {
    listContainer.innerHTML = '';
    const keys = Object.keys(prompts).sort((a, b) => a.localeCompare(b));

    if (keys.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<strong>No prompts yet.</strong><div style="margin-top:8px">Use the form on the right to create your first master prompt.</div>';
      listContainer.appendChild(empty);
      clearSelectionUI();
      return;
    }

    keys.forEach((key) => {
      const row = document.createElement('div');
      row.className = 'prompt-card';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.padding = '14px 16px';
      row.style.cursor = 'pointer';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = key;
      nameSpan.style.flex = '1';
      nameSpan.style.fontSize = '14px';
      nameSpan.style.fontWeight = '500';
      nameSpan.style.color = '#1f2937';
      nameSpan.style.cursor = 'pointer';

      row.addEventListener('click', () => {
        selectedKey = key;
        editing = false;
        const pName = document.getElementById('pName') as HTMLInputElement;
        const pText = document.getElementById('pText') as HTMLTextAreaElement;
        pName.value = key;
        pText.value = prompts[key] || '';
        toggleEditButtons();
      });

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.className = 'btn-delete';
      delBtn.style.marginLeft = '10px';
      delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (confirm(`Are you absolutely sure you want to delete the master prompt: "${key}"?`)) {
          getAllPrompts().then((existing) => {
            const updated = { ...existing };
            delete updated[key];
            savePrompts(updated).then(() => {
              broadcastChange();
              if (selectedKey === key) clearSelectionUI();
              renderDashboard();
            });
          });
        }
      });

      row.appendChild(nameSpan);
      row.appendChild(delBtn);
      listContainer.appendChild(row);
    });
  });
}

function wireDashboard() {
  const saveBtn = document.getElementById('saveBtn')! as HTMLButtonElement;
  const pName = document.getElementById('pName')! as HTMLInputElement;
  const pText = document.getElementById('pText')! as HTMLTextAreaElement;
  const updateBtn = document.getElementById('updateBtn')! as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancelBtn')! as HTMLButtonElement;
  const exportBtn = document.getElementById('exportBtn')! as HTMLButtonElement;
  const importBtn = document.getElementById('importBtn')! as HTMLButtonElement;
  const importFile = document.getElementById('importFile')! as HTMLInputElement;
  // Save/Create handler - behaves differently when editing an existing prompt
  saveBtn.addEventListener('click', () => {
    const nameKey = normalizeKey(pName.value);
    const textValue = pText.value ? pText.value.normalize('NFC') : '';

    if (!nameKey) {
      alert('Error: Stored items cannot possess empty keys.');
      return;
    }
    if (!textValue) {
      alert('Error: Master prompt text cannot be empty.');
      return;
    }

    getAllPrompts().then((existing) => {
      // If updating an existing selected prompt
      if (selectedKey && editing) {
        const updated = { ...existing };
        // handle rename
        if (nameKey !== selectedKey) {
          delete updated[selectedKey];
        }
        updated[nameKey] = textValue;
        savePrompts(updated).then(() => {
          broadcastChange();
          selectedKey = nameKey;
          editing = false;
          toggleEditButtons();
          renderDashboard();
        });
        return;
      }

      // New prompt creation (no selection)
      const updated = { ...existing, [nameKey]: textValue };
      savePrompts(updated).then(() => {
        broadcastChange();
        pName.value = '';
        pText.value = '';
        renderDashboard();
      });
    });
  });

  // Update puts the UI into edit mode for the selected prompt
  updateBtn.addEventListener('click', () => {
    if (!selectedKey) return;
    editing = true;
    toggleEditButtons();
  });

  // Cancel reverts changes for selected prompt
  cancelBtn.addEventListener('click', () => {
    if (!selectedKey) {
      clearSelectionUI();
      return;
    }
    getAllPrompts().then((prompts) => {
      const pNameEl = document.getElementById('pName') as HTMLInputElement;
      const pTextEl = document.getElementById('pText') as HTMLTextAreaElement;
      pNameEl.value = selectedKey as string;
      pTextEl.value = prompts[selectedKey as string] || '';
      editing = false;
      toggleEditButtons();
    });
  });

  exportBtn.addEventListener('click', () => {
    getAllPrompts().then((prompts) => {
      const blob = new Blob([JSON.stringify(prompts, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
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

  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', (ev) => {
    const target = ev.target as HTMLInputElement;
    const file = target.files && target.files[0];
    if (!file) return;

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

        getAllPrompts().then((existing) => {
          const normalized: Record<string, string> = {};
          Object.keys(parsed).forEach((key) => {
            const normalizedKey = normalizeKey(String(key));
            const value = parsed[key];
            normalized[normalizedKey] = String(value).normalize('NFC');
          });
          const merged = { ...existing, ...normalized };
          savePrompts(merged).then(() => {
            broadcastChange();
            renderDashboard();
            alert('Import successful.');
          });
        });
      } catch (err) {
        console.error('Failed to parse import file:', err);
        alert('Failed to parse JSON file.');
      }
    };
    reader.readAsText(file, 'utf-8');
    target.value = '';
  });
}

window.addEventListener('DOMContentLoaded', () => {
  wireDashboard();
  renderDashboard();
});
