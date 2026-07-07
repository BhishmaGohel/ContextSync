let activeOverlay: HTMLElement | null = null;

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
  tokenEndChar: number
) {
  clearOverlayContainer();

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
    });

    document.body.appendChild(menuDiv);
    activeOverlay = menuDiv;
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
  const re = /(?:^|\s)(\/(?:masterprompt|mstp))\s$/i;
  const m = textBefore.match(re);
  if (m) {
    const token = m[1];
    const tokenLength = token.length;
    const tokenEndChar = textBefore.length - 1;
    const tokenStartChar = tokenEndChar - tokenLength;
    mountUIOverlayForToken(node, tokenStartChar, tokenEndChar);
  }
}

function handleDocumentMouseDown(event: MouseEvent) {
  if (activeOverlay && !activeOverlay.contains(event.target as Node)) {
    setTimeout(clearOverlayContainer, 120);
  }
}

document.addEventListener('input', handleInputEvent);
document.addEventListener('mousedown', handleDocumentMouseDown);
