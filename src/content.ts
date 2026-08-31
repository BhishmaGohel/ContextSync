let activeOverlay: HTMLElement | null = null;

type EncryptedData = {
  ciphertext: string;
  iv: string;
  salt: string;
};

type HiddenPromptMap = Record<string, EncryptedData | string>;

function getHiddenPrompts(): Promise<HiddenPromptMap> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(['hidden_prompts'], (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }
        resolve((result.hidden_prompts || {}) as HiddenPromptMap);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function getHiddenPasswordHash(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(['hidden_prompts_password_hash'], (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }
        resolve((result.hidden_prompts_password_hash as string) || null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function hashPassword(password: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function decryptData(encryptedData: EncryptedData, password: string): Promise<string> {
  const decode = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: decode(encryptedData.salt), iterations: 100000, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(encryptedData.iv) },
    key,
    decode(encryptedData.ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

// Safe storage accessor: avoids uncaught exceptions when extension context is invalidated
function getPromptStore(callback: (store: any) => void) {
  try {
    if (window.chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
      try {
        chrome.storage.local.get({ promptMap: {}, contextsync_prompts: {} }, (store: any) => {
          // Merge both legacy and new keys
          const merged: Record<string, string> = {};
          if (store.promptMap) {
            Object.assign(merged, store.promptMap);
          }
          if (store.contextsync_prompts) {
            Object.assign(merged, store.contextsync_prompts);
          }
          callback(merged);
        });
        return;
      } catch (err) {
        console.warn('chrome.storage.local.get failed:', err);
      }
    }
  } catch (err) {
    console.warn('chrome.storage unavailable:', err);
  }

  // Fallback to empty store
  callback({});
}

function clearOverlayContainer() {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
}

function dispatchInputEvents(element: HTMLElement | HTMLTextAreaElement | HTMLInputElement) {
  const inputEvt = new Event('input', { bubbles: true, cancelable: true });
  const changeEvt = new Event('change', { bubbles: true, cancelable: true });
  element.dispatchEvent(inputEvt);
  element.dispatchEvent(changeEvt);
}

function getTextBeforeCaret(node: HTMLElement | HTMLTextAreaElement | HTMLInputElement) {
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
    const val = node.value || '';
    const pos = node.selectionStart || 0;
    return val.slice(0, pos);
  }

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  const range = sel.getRangeAt(0).cloneRange();
  range.setStart(node, 0);
  return range.toString();
}

function findEditableTarget(node: EventTarget | null): HTMLElement | HTMLTextAreaElement | HTMLInputElement | null {
  if (!node) return null;
  if (node instanceof Text) node = node.parentElement;
  if (!(node instanceof HTMLElement)) return null;

  const selectors = [
    'textarea',
    'input',
    '[contenteditable="true"]',
    '[contenteditable]',
    '#tap-input-field',
    '[name="user-prompt"]',
    'textarea[inputmode="text"]'
  ];

  const sel = selectors.join(',');
  if (node.matches(sel)) return node as HTMLElement;
  const closest = node.closest(sel);
  return closest as HTMLElement | null;
}

function getCaretClientRect(node: HTMLElement | HTMLTextAreaElement | HTMLInputElement) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[0];
  }
  return node.getBoundingClientRect();
}

function createOverlayAt(position: DOMRect) {
  const menuDiv = document.createElement('div');
  menuDiv.className = 'prompt-injector-overlay';
  menuDiv.style.position = 'absolute';
  menuDiv.style.zIndex = '2147483647';
  menuDiv.style.top = `${window.scrollY + position.top - 12}px`;
  menuDiv.style.left = `${window.scrollX + position.left}px`;
  return menuDiv;
}

function mountUIOverlayForToken(
  targetNode: HTMLElement | HTMLTextAreaElement | HTMLInputElement,
  tokenStartChar: number,
  tokenEndChar: number,
  hiddenPassword?: string
) {
  clearOverlayContainer();

  if (hiddenPassword) {
    getHiddenPrompts().then((hiddenPrompts) => {
      const promptKeys = Object.keys(hiddenPrompts);
      if (promptKeys.length === 0) return;

      promptKeys.sort((a, b) => a.localeCompare(b));
      const caretRect = getCaretClientRect(targetNode);
      const menuDiv = createOverlayAt(caretRect);

      const labelHeader = document.createElement('div');
      labelHeader.className = 'prompt-injector-title';
      labelHeader.textContent = 'Insert Hidden Master Prompt:';
      menuDiv.appendChild(labelHeader);

      // Create the search input
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.style.background = 'white';
      searchInput.style.fontFamily = 'sans-serif';
      searchInput.style.color = '#1f2937';
      searchInput.style.width = '80%';
      searchInput.style.height = '24px';
      searchInput.style.borderRadius = '10px';
      searchInput.style.marginLeft = '12px';
      searchInput.style.paddingLeft = '10px';
      searchInput.className = 'prompt-injector-search'; // Add a CSS class if you want to style it
      searchInput.placeholder = 'Search prompts...';
      // Prevent mousedown from blurring or triggering unwanted behavior on the menu
      searchInput.addEventListener('mousedown', (e) => e.stopPropagation());
      menuDiv.appendChild(searchInput);

      // Keep track of row elements to filter them later
      const rowElements: { element: HTMLDivElement; keyName: string }[] = [];

      promptKeys.forEach((keyName) => {
        const selectionRow = document.createElement('div');
        selectionRow.className = 'prompt-injector-option';
        selectionRow.textContent = keyName;
        selectionRow.addEventListener('mousedown', async (clickEvent) => {
          clickEvent.preventDefault();
          const storedPrompt = hiddenPrompts[keyName];
          try {
            const promptText = typeof storedPrompt === 'string'
              ? storedPrompt
              : await decryptData(storedPrompt as EncryptedData, hiddenPassword);
            replaceTokenWithPrompt(targetNode, tokenStartChar, tokenEndChar, promptText);
            clearOverlayContainer();
          } catch {
            alert('Unable to decrypt hidden prompt. The password may be incorrect or the data corrupted.');
            clearOverlayContainer();
          }
        });
        menuDiv.appendChild(selectionRow);
        rowElements.push({ element: selectionRow, keyName });
      });

      // Add filter logic
      searchInput.addEventListener('input', (e) => {
        const query = (e.target as HTMLInputElement).value.toLowerCase();
        rowElements.forEach(({ element, keyName }) => {
          if (keyName.toLowerCase().includes(query)) {
            element.style.display = ''; // Show row
          } else {
            element.style.display = 'none'; // Hide row
          }
        });
      });

      document.body.appendChild(menuDiv);
      activeOverlay = menuDiv;

      // Optional: Automatically focus the search bar when the menu opens
      setTimeout(() => searchInput.focus(), 0);
    }).catch(() => {
      alert('Unable to load hidden prompts.');
    });
    return;
  }

  getPromptStore((promptMap: Record<string, string>) => {
    const promptKeys = Object.keys(promptMap);
    if (promptKeys.length === 0) return;

    promptKeys.sort((a, b) => a.localeCompare(b));
    const caretRect = getCaretClientRect(targetNode);
    const menuDiv = createOverlayAt(caretRect);

    const labelHeader = document.createElement('div');
    labelHeader.className = 'prompt-injector-title';
    labelHeader.textContent = 'Insert Saved Master Prompt:';
    menuDiv.appendChild(labelHeader);

    // Create the search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.style.background = 'white';
    searchInput.style.fontFamily = 'sans-serif';
    searchInput.style.color = '#1f2937';
    searchInput.style.width = '80%';
    searchInput.style.height = '24px';
    searchInput.style.borderRadius = '10px';
    searchInput.style.marginLeft = '12px';
    searchInput.style.paddingLeft = '10px';
    searchInput.className = 'prompt-injector-search'; // Add a CSS class if you want to style it
    searchInput.placeholder = 'Search prompts...';
    // Prevent mousedown from blurring or triggering unwanted behavior on the menu
    searchInput.addEventListener('mousedown', (e) => e.stopPropagation());
    menuDiv.appendChild(searchInput);

    // Keep track of row elements to filter them later
    const rowElements: { element: HTMLDivElement; keyName: string }[] = [];

    promptKeys.forEach((keyName) => {
      const selectionRow = document.createElement('div');
      selectionRow.className = 'prompt-injector-option';
      selectionRow.textContent = keyName;
      selectionRow.addEventListener('mousedown', (clickEvent) => {
        clickEvent.preventDefault();
        const promptText = promptMap[keyName] || '';
        replaceTokenWithPrompt(targetNode, tokenStartChar, tokenEndChar, promptText);
        clearOverlayContainer();
      });
      menuDiv.appendChild(selectionRow);
      rowElements.push({ element: selectionRow, keyName });
    });

    // Add filter logic
    searchInput.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value.toLowerCase();
      rowElements.forEach(({ element, keyName }) => {
        if (keyName.toLowerCase().includes(query)) {
          element.style.display = ''; // Show row
        } else {
          element.style.display = 'none'; // Hide row
        }
      });
    });

    document.body.appendChild(menuDiv);
    activeOverlay = menuDiv;

    // Optional: Automatically focus the search bar when the menu opens
    setTimeout(() => searchInput.focus(), 0);
  });
}

function replaceTokenWithPrompt(
  element: HTMLElement | HTMLTextAreaElement | HTMLInputElement,
  tokenStartChar: number,
  tokenEndChar: number,
  promptText: string
) {
  const inserted = promptText + '\n';

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const value = element.value || '';
    const before = value.slice(0, tokenStartChar);
    const after = value.slice(element.selectionStart || 0);
    element.value = before + inserted + after;
    element.focus();
    const newPos = before.length + inserted.length;
    element.setSelectionRange(newPos, newPos);
    dispatchInputEvents(element);
    return;
  }

  const root = element;
  const sel = window.getSelection();
  if (!sel) return;

  function rangeFromCharOffsets(rootEl: HTMLElement, start: number, end: number) {
    const range = document.createRange();
    let charIndex = 0;
    let startSet = false;

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();

    while (node) {
      const textNode = node as Text;
      const nextCharIndex = charIndex + textNode.length;
      if (!startSet && start >= charIndex && start <= nextCharIndex) {
        range.setStart(textNode, start - charIndex);
        startSet = true;
      }
      if (startSet && end >= charIndex && end <= nextCharIndex) {
        range.setEnd(textNode, end - charIndex);
        return range;
      }
      charIndex = nextCharIndex;
      node = walker.nextNode();
    }

    return range;
  }

  const range = rangeFromCharOffsets(root, tokenStartChar, tokenEndChar);
  range.deleteContents();
  const textNode = document.createTextNode(inserted);
  range.insertNode(textNode);

  sel.removeAllRanges();
  const newRange = document.createRange();
  const len = textNode.nodeValue ? textNode.nodeValue.length : 0;
  newRange.setStart(textNode, len);
  newRange.collapse(true);
  sel.addRange(newRange);
  dispatchInputEvents(element);
}

function handleInputEvent(event: Event) {
  const node = findEditableTarget(event.target);
  if (!node) return;

  const textBefore = getTextBeforeCaret(node);
  const re = /(?:^|\s)(\/(masterprompt|mstp|hmstp|hiddenmasterprompt))\s$/i;
  const m = textBefore.match(re);
  if (m) {
    const token = m[1];
    const tokenLength = token.length;
    const tokenEndChar = textBefore.length - 1;
    const tokenStartChar = tokenEndChar - tokenLength;
    if (m[2].toLowerCase() === 'hmstp' || m[2].toLowerCase() === 'hiddenmasterprompt') {
      promptForHiddenPassword(node, tokenStartChar, tokenEndChar);
    } else {
      mountUIOverlayForToken(node, tokenStartChar, tokenEndChar);
    }
  }
}

async function promptForHiddenPassword(
  targetNode: HTMLElement | HTMLTextAreaElement | HTMLInputElement,
  tokenStartChar: number,
  tokenEndChar: number
) {
  const password = prompt('Enter password to use a hidden prompt:');
  if (!password) return;

  try {
    const expectedHash = await getHiddenPasswordHash();
    if (!expectedHash || expectedHash !== await hashPassword(password)) {
      alert('Incorrect password.');
      return;
    }
    mountUIOverlayForToken(targetNode, tokenStartChar, tokenEndChar, password);
  } catch {
    alert('Unable to verify the hidden prompt password.');
  }
}

function handleDocumentMouseDown(event: MouseEvent) {
  if (activeOverlay && !activeOverlay.contains(event.target as Node)) {
    setTimeout(clearOverlayContainer, 120);
  }
}

document.addEventListener('input', handleInputEvent);
document.addEventListener('mousedown', handleDocumentMouseDown);
