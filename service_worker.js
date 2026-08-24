chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === 'DOWNLOAD_FILE') {
    try {
      const blob = new Blob([message.content || ''], { type: message.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: message.filename || 'download.bin', saveAs: true }, (id) => {
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, id });
        }
      });
      return true; // keep channel open for sendResponse
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  }
});

// When the user clicks the extension action, inject the content scripts and
// show the persistent in-page panel (single-window UI behavior).
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  const tabId = tab.id;
  chrome.scripting.executeScript(
    { target: { tabId }, files: ['src/parser.js', 'src/content.js'] },
    () => {
      if (chrome.runtime.lastError) {
        console.error('Script injection failed:', chrome.runtime.lastError.message);
        return;
      }
      chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PROFILE_DATA' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('SendMessage failed:', chrome.runtime.lastError.message);
          return;
        }
        if (response?.ok) {
          chrome.tabs.sendMessage(tabId, { type: 'SHOW_PERSISTENT_PANEL', data: response.data });
        } else {
          // If extraction failed, still ask the page to create the panel (empty)
          chrome.tabs.sendMessage(tabId, { type: 'SHOW_PERSISTENT_PANEL', data: {} });
        }
      });
    }
  );
});
