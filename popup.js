const extractBtn = document.getElementById("extractBtn");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");
const saveNotionBtn = document.getElementById("saveNotionBtn");
const notionDbSelect = document.getElementById("notionDbSelect");
const connectNotionBtn = document.getElementById("connectNotionBtn");
const connectedStatusEl = document.getElementById("connectedStatus");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");

const NOTION_STORAGE_KEY = "notionSettings";
const SERVER_ORIGIN = "http://localhost:3000"; // change if your server runs elsewhere

let lastData = null;

function setStatus(message) {
  statusEl.textContent = message;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderJsonPreview(data) {
  outputEl.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  outputEl.classList.remove("hidden");
}

function showResult(data) {
  renderJsonPreview(data);
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function ensureContentScriptInjected(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/parser.js", "src/content.js"]
  });
}

async function requestData() {
  extractBtn.disabled = true;
  downloadJsonBtn.disabled = true;
  setStatus("Reading current page...");
  outputEl.classList.add("hidden");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    await ensureContentScriptInjected(tab.id);

    const response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PROFILE_DATA" });
    if (!response?.ok) throw new Error(response?.error || "Extraction failed.");

    lastData = response.data;
    showResult(lastData);
    setStatus("Done.");
    downloadJsonBtn.disabled = false;
    saveNotionBtn.disabled = false;
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    extractBtn.disabled = false;
  }
}

function downloadJson() {
  if (!lastData) return;
  const filename = "ln-user-extract-profile.json";
  downloadFile(filename, JSON.stringify(lastData, null, 2), "application/json");
}

async function loadNotionSettings() {
  const stored = await chrome.storage.local.get(NOTION_STORAGE_KEY);
  const settings = stored[NOTION_STORAGE_KEY] || {};
  if (settings.databaseId) {
    // select will be populated after fetchDatabases; store desired id for later selection
    notionDbSelect.dataset.selected = settings.databaseId;
  }
  if (settings.client_token) {
    connectedStatusEl.textContent = 'Connected';
    fetchDatabases(settings.client_token);
  }
}

async function persistSelectedDatabase(dbId) {
  const stored = await chrome.storage.local.get(NOTION_STORAGE_KEY);
  const settings = stored[NOTION_STORAGE_KEY] || {};
  settings.databaseId = dbId || '';
  await chrome.storage.local.set({ [NOTION_STORAGE_KEY]: settings });
}

async function saveClientToken(clientToken) {
  const stored = await chrome.storage.local.get(NOTION_STORAGE_KEY);
  const settings = stored[NOTION_STORAGE_KEY] || {};
  settings.client_token = clientToken;
  await chrome.storage.local.set({ [NOTION_STORAGE_KEY]: settings });
  connectedStatusEl.textContent = 'Connected';
}

async function fetchDatabases(clientToken) {
  try {
    setStatus('Fetching Notion databases...');
    const res = await fetch(`${SERVER_ORIGIN}/api/databases`, { headers: { Authorization: `Bearer ${clientToken}` } });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Failed to fetch databases');
    populateDatabaseSelect(body.databases || []);
    setStatus('Databases loaded');
  } catch (err) {
    console.error(err);
    setStatus('Could not load databases');
  }
}

function populateDatabaseSelect(dbs) {
  notionDbSelect.innerHTML = '<option value="">(none)</option>';
  dbs.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.title || d.id;
    notionDbSelect.appendChild(opt);
  });

  // If a previously selected database id was stored, try to select it
  const desired = notionDbSelect.dataset.selected;
  if (desired) {
    const opt = Array.from(notionDbSelect.options).find((o) => o.value === desired);
    if (opt) {
      opt.selected = true;
      persistSelectedDatabase(desired);
    }
    delete notionDbSelect.dataset.selected;
  }
}

async function connectToNotion() {
  // Open the server OAuth start URL — server will redirect to Notion and callback posts token back
  const url = `${SERVER_ORIGIN}/auth/start`;
  const win = window.open(url, 'notion_oauth', 'width=600,height=800');

  // Listen for postMessage from the popup callback
  function onMessage(e) {
    try {
      if (!e.data || e.data.type !== 'NOTION_CLIENT_TOKEN') return;
      const clientToken = e.data.token;
      if (clientToken) {
        saveClientToken(clientToken);
        fetchDatabases(clientToken);
      }
    } finally {
      window.removeEventListener('message', onMessage);
      if (win && !win.closed) win.close();
    }
  }

  window.addEventListener('message', onMessage);
}

async function saveToNotion() {
  if (!lastData) return;

  // Use server client_token exclusively
  const stored = await chrome.storage.local.get(NOTION_STORAGE_KEY);
  const settings = stored[NOTION_STORAGE_KEY] || {};
  const clientToken = settings.client_token || null;
  const databaseId = notionDbSelect.value;

  saveNotionBtn.disabled = true;
  setStatus('Saving to Notion...');

  try {
    if (!clientToken) throw new Error('Not connected to Notion. Click "Connect to Notion" first.');
    if (!databaseId) throw new Error('Select a Notion database first.');

    const res = await fetch(`${SERVER_ORIGIN}/api/save-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clientToken}` },
      body: JSON.stringify({ notion_database_id: databaseId, profile: lastData }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Save failed');
    setStatus(`Saved to Notion: ${body.page?.url || body.page?.id || 'ok'}`);
  } catch (error) {
    setStatus(`Notion error: ${error.message}`);
  } finally {
    saveNotionBtn.disabled = !lastData;
  }
}

// Wire up UI controls
extractBtn.addEventListener("click", requestData);
downloadJsonBtn.addEventListener("click", downloadJson);
saveNotionBtn.addEventListener("click", saveToNotion);
connectNotionBtn.addEventListener('click', connectToNotion);
notionDbSelect.addEventListener('change', (e) => { persistSelectedDatabase(e.target.value); });

loadNotionSettings();
