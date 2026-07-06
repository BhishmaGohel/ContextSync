document.addEventListener('DOMContentLoaded', () => {
  const pName = document.getElementById('pName');
  const pText = document.getElementById('pText');
  const saveBtn = document.getElementById('saveBtn');
  const listContainer = document.getElementById('listContainer');

  // Core Storage Engine Wrapper (ACID-aligned atomic mutations on a single JSON tree key)
  const StorageEngine = {
    getAll: (callback) => {
      chrome.storage.sync.get({ promptMap: {} }, (data) => callback(data.promptMap));
    },
    save: (key, value, callback) => {
      chrome.storage.sync.get({ promptMap: {} }, (data) => {
        const updated = { ...data.promptMap, [key]: value };
        chrome.storage.sync.set({ promptMap: updated }, callback);
      });
    },
    delete: (key, callback) => {
      chrome.storage.sync.get({ promptMap: {} }, (data) => {
        const updated = { ...data.promptMap };
        delete updated[key];
        chrome.storage.sync.set({ promptMap: updated }, callback);
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
    const textValue = pText.value.trim();

    if (!nameKey || !textValue) {
      alert('Error: Stored items cannot possess empty keys or payload definitions.');
      return;
    }

    StorageEngine.save(nameKey, textValue, () => {
      pName.value = '';
      pText.value = '';
      renderDashboard();
    });
  });

  renderDashboard();
});
