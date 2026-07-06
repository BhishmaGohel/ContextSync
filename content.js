let activeOverlay = null;

const HISTORIC_DOM_INDICATORS = [
  // preserved for potential future checks
];

function isFreshSession() {
  for (const query of HISTORIC_DOM_INDICATORS) {
    if (document.querySelector(query)) return false;
  }
  return true;
}

function clearOverlayContainer() {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
}

// Safe storage accessor: avoids uncaught exceptions when extension context is invalidated
function getPromptStore(callback) {
  try {
    if (window.chrome && chrome.storage && chrome.storage.sync && typeof chrome.storage.sync.get === 'function') {
      // wrap in try/catch in case the API throws synchronously
      try {
        chrome.storage.sync.get({ promptMap: {} }, (store) => {
          callback(store);
        });
        return;
      } catch (err) {
        console.warn('chrome.storage.sync.get failed:', err);
      }
    }
  } catch (err) {
    console.warn('chrome.storage unavailable:', err);
  }

  // Fallback to empty store
  callback({ promptMap: {} });
}

function dispatchInputEvents(element) {
  const inputEvt = new Event('input', { bubbles: true, cancelable: true });
  const changeEvt = new Event('change', { bubbles: true, cancelable: true });
  element.dispatchEvent(inputEvt);
  element.dispatchEvent(changeEvt);
}

function getTextBeforeCaret(node) {
  if (!node) return '';
  if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') {
    const val = node.value || '';
    try {
      const pos = node.selectionStart || 0;
      return val.slice(0, pos);
    } catch (e) {
      return val;
    }
  }

  // contenteditable
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  const range = sel.getRangeAt(0).cloneRange();
  const root = node;
  try {
    range.setStart(root, 0);
    return range.toString();
  } catch (e) {
    return range.toString();
  }
}

function getCaretClientRect(node) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[0];
  }
  return node.getBoundingClientRect();
}

function createOverlayAt(position) {
  const menuDiv = document.createElement('div');
  menuDiv.className = 'prompt-injector-overlay';
  menuDiv.style.position = 'absolute';
  menuDiv.style.zIndex = 2147483647;
  menuDiv.style.top = `${window.scrollY + position.top - 12}px`;
  menuDiv.style.left = `${window.scrollX + position.left}px`;
  return menuDiv;
}

function mountUIOverlayForToken(targetNode, tokenStartChar, tokenEndChar) {
  clearOverlayContainer();

  if (!isFreshSession()) return;

  getPromptStore((store) => {
    const promptKeys = Object.keys((store && store.promptMap) || {});
    if (promptKeys.length === 0) return;

    promptKeys.sort((a, b) => a.localeCompare(b));

    const caretRect = getCaretClientRect(targetNode);
    const menuDiv = createOverlayAt(caretRect);

    const labelHeader = document.createElement('div');
    labelHeader.className = 'prompt-injector-title';
    labelHeader.textContent = 'Insert Saved Master Prompt:';
    menuDiv.appendChild(labelHeader);

    promptKeys.forEach(keyName => {
      const selectionRow = document.createElement('div');
      selectionRow.className = 'prompt-injector-option';
      selectionRow.textContent = keyName;

      selectionRow.addEventListener('mousedown', (clickEvent) => {
        clickEvent.preventDefault();
        const promptText = store.promptMap[keyName] || '';
        replaceTokenWithPrompt(targetNode, tokenStartChar, tokenEndChar, promptText);
        clearOverlayContainer();
      });

      menuDiv.appendChild(selectionRow);
    });

    document.body.appendChild(menuDiv);
    activeOverlay = menuDiv;
  });
}

function replaceTokenWithPrompt(element, tokenStartChar, tokenEndChar, promptText) {
  // New behavior: keep the token text (e.g. /mstp) and append the prompt after it,
  // followed by a newline. Place the caret on the new empty line.
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    const value = element.value || '';
    const before = value.slice(0, tokenEndChar);
    const after = value.slice((element.selectionStart || 0));
    const inserted = ' ' + promptText + '\n';
    const newValue = before + inserted + after;
    element.focus();
    element.value = newValue;
    const newPos = before.length + inserted.length;
    element.setSelectionRange(newPos, newPos);
    dispatchInputEvents(element);
    return;
  }

  // contenteditable: insert after tokenEndChar without removing the token
  const root = element;
  const sel = window.getSelection();
  if (!sel) return;

  // helper: create a collapsed range at a character offset within root
  function collapsedRangeAt(rootEl, offset) {
    const range = document.createRange();
    let charIndex = 0;
    (function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const nextCharIndex = charIndex + node.length;
        if (offset >= charIndex && offset <= nextCharIndex) {
          range.setStart(node, offset - charIndex);
          range.collapse(true);
          throw range;
        }
        charIndex = nextCharIndex;
      } else {
        for (let i = 0; i < node.childNodes.length; i++) {
          walk(node.childNodes[i]);
        }
      }
    })(rootEl);
    return range;
  }

  let pointRange;
  try {
    pointRange = collapsedRangeAt(root, tokenEndChar);
  } catch (r) {
    if (r instanceof Range) pointRange = r;
  }
  if (!pointRange) return;
  // Insert prompt as plain text (no HTML wrappers), followed by a newline
  const insertText = ' ' + promptText + '\n';
  const textNode = document.createTextNode(insertText);
  pointRange.insertNode(textNode);

  // place caret after the inserted text node
  sel.removeAllRanges();
  const newRange = document.createRange();
  const len = textNode.nodeValue ? textNode.nodeValue.length : 0;
  newRange.setStart(textNode, len);
  newRange.collapse(true);
  sel.addRange(newRange);
  dispatchInputEvents(element);
}

// Listen for typed trigger tokens (case-insensitive) and show overlay after a trailing space
document.addEventListener('input', (event) => {
  const node = event.target;
  const matchCriteria = node && (node.tagName === 'TEXTAREA' ||
    node.tagName === 'INPUT' ||
    node.hasAttribute && node.hasAttribute('contenteditable') ||
    node.contentEditable === 'true');

  if (!matchCriteria) return;

  const textBefore = getTextBeforeCaret(node);
  const re = /(?:^|\s)(\/(?:masterprompt|mstp))\s$/i; // trailing space required
  const m = textBefore.match(re);
  if (m) {
    const token = m[1];
    const tokenLength = token.length;
    const tokenEndChar = textBefore.length - 1; // excluding trailing space
    const tokenStartChar = tokenEndChar - tokenLength;
    mountUIOverlayForToken(node, tokenStartChar, tokenEndChar);
  }
});

// Dismiss overlay when clicking outside
document.addEventListener('mousedown', (event) => {
  if (activeOverlay && !activeOverlay.contains(event.target)) {
    setTimeout(clearOverlayContainer, 120);
  }
});
