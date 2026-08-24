const extractBtn = document.getElementById("extractBtn");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");
const saveNotionBtn = document.getElementById("saveNotionBtn");
const persistentCloseBtn = document.getElementById('persistentClose');
const notionDbSelect = document.getElementById("notionDbSelect");
const connectNotionBtn = document.getElementById("connectNotionBtn");
const connectedStatusEl = document.getElementById("connectedStatus");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");

const NOTION_STORAGE_KEY = "notionSettings";
const SERVER_ORIGIN = "http://localhost:3000"; // change if your server runs elsewhere

let lastData = null;

// If the popup is opened as the browser action popup, auto-open a persistent
// window that remains open until the user closes it. The persistent window
// is the same UI served from `persistent.html?persistent=1` and uses the
// same scripts/styles. If the current page is already the persistent window
// (presence of the query param), do nothing.
// (Removed previous persistent window auto-open — replaced by in-page panel.)

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

function renderProfilePreview(data) {
  if (!data) {
    outputEl.innerHTML = "";
    outputEl.classList.add("hidden");
    return;
  }

  const makeField = (label, key, value, opts = {}) => {
    const v = value == null || value === "" ? "" : escapeHtml(value);
    const editable = opts.readOnly ? "" : ' contenteditable="true"';
    return `<div class="field"><h2>${escapeHtml(label)}:</h2><div class="value" data-key="${escapeHtml(key)}"${editable}>${v}</div></div>`;
  };

  let html = `<div class="profile">`;
  html += makeField('URL', 'url', data.url);
  html += makeField('Email', 'email', data.email || '');
  html += makeField('Name', 'name', data.name);
  html += makeField('Headline', 'headline', data.headline);
  html += makeField('Location', 'location', data.location);
  html += `<div class="field"><h2>About:</h2><div class="value" data-key="about" contenteditable="true">${escapeHtml(data.about || '')}</div></div>`;

  // Experience
  html += `<h3>Experience</h3>`;
  if (Array.isArray(data.experience) && data.experience.length) {
    html += `<div class="experience">`;
    data.experience.forEach((e, idx) => {
      const company = escapeHtml(e['Company name'] || '');
      const title = escapeHtml(e.Title || '');
      const content = escapeHtml(e.Content || '');
      const loc = escapeHtml(e.Location || '');
      html += `<div class="exp-item" data-exp-index="${idx}">`;
      html += `<div class="exp-header"><div class="exp-company" data-exp-field="company" contenteditable="true">${company}</div><div class="exp-title" data-exp-field="title" contenteditable="true">${title}</div></div>`;
      html += `<div class="exp-content" data-exp-field="content" contenteditable="true">${content}</div>`;
      html += `<div class="exp-location" data-exp-field="location" contenteditable="true">${loc}</div>`;
      html += `</div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="value">—</div>`;
  }

  // Featured
  html += `<h3>Featured</h3>`;
  if (Array.isArray(data.featured) && data.featured.length) {
    html += `<div class="featured">`;
    data.featured.forEach((f, idx) => {
      const postType = escapeHtml(f['Post type'] || '');
      const content = escapeHtml(f.Content || '');
      html += `<div class="featured-item" data-featured-index="${idx}"><div class="featured-type" data-featured-field="type" contenteditable="true"><strong>${postType || 'Post'}</strong></div><div class="featured-content" data-featured-field="content" contenteditable="true">${content}</div></div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="value">—</div>`;
  }

  // Activity
  html += `<h3>Activity</h3>`;
  if (Array.isArray(data.activity) && data.activity.length) {
    html += `<div class="activity">`;
    data.activity.forEach((a, idx) => {
      const postType = escapeHtml(a['Post type'] || '');
      const content = escapeHtml(a.Content || '');
      html += `<div class="activity-item" data-activity-index="${idx}"><div class="activity-type" data-activity-field="type" contenteditable="true"><strong>${postType || 'Post'}</strong></div><div class="activity-content" data-activity-field="content" contenteditable="true">${content}</div></div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="value">—</div>`;
  }

  // Notes field
  html += `<div class="field"><h2>Notes:</h2><div class="value" data-key="notes" contenteditable="true">${escapeHtml(data.notes || '')}</div></div>`;

  html += `</div>`;

  outputEl.innerHTML = html;
  outputEl.classList.remove("hidden");
}

function showResult(data) {
  renderProfilePreview(data);
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
    // Send data to the active tab to display a persistent in-page panel
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_PERSISTENT_PANEL', data: lastData });
      setStatus('Panel opened in page.');
      // close the popup so the panel remains in-page
      window.close();
      return;
    } catch (e) {
      // If the content script isn't available, fallback to popup rendering
      showResult(lastData);
      setStatus('Done.');
    }
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
  syncEditedProfileToLastData();
  const filename = "ln-user-extract-profile.json";
  const content = JSON.stringify(lastData, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  // Prefer using chrome.downloads with saveAs:true to prompt for location.
  try {
    if (chrome?.downloads?.download) {
      chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
        // revoke objectURL shortly after the download is created
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        if (chrome.runtime.lastError) {
          // fallback to anchor-based download if downloads API failed
          downloadFile(filename, content, "application/json");
        }
      });
      return;
    }
  } catch (err) {
    // ignore and fallback
  }

  // Fallback for environments without chrome.downloads
  downloadFile(filename, content, "application/json");
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

  // synchronize any user edits in the UI back into the data object
  syncEditedProfileToLastData();

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

function syncEditedProfileToLastData() {
  if (!lastData) return;

  // top-level fields
  ['url','email','name','headline','location','about','notes'].forEach((k) => {
    const el = outputEl.querySelector(`[data-key="${k}"]`);
    if (el) lastData[k] = el.innerText.trim();
  });

  // experience entries
  const expItems = outputEl.querySelectorAll('.exp-item');
  if (expItems && expItems.length) {
    lastData.experience = lastData.experience || [];
    expItems.forEach((item) => {
      const idx = Number(item.getAttribute('data-exp-index'));
      lastData.experience[idx] = lastData.experience[idx] || {};
      const company = item.querySelector('[data-exp-field="company"]')?.innerText.trim() || '';
      const title = item.querySelector('[data-exp-field="title"]')?.innerText.trim() || '';
      const content = item.querySelector('[data-exp-field="content"]')?.innerText.trim() || '';
      const loc = item.querySelector('[data-exp-field="location"]')?.innerText.trim() || '';
      lastData.experience[idx]['Company name'] = company;
      lastData.experience[idx].Title = title;
      lastData.experience[idx].Content = content;
      lastData.experience[idx].Location = loc;
    });
  }

  // featured
  const featuredItems = outputEl.querySelectorAll('[data-featured-index]');
  if (featuredItems && featuredItems.length) {
    lastData.featured = lastData.featured || [];
    featuredItems.forEach((item) => {
      const idx = Number(item.getAttribute('data-featured-index'));
      lastData.featured[idx] = lastData.featured[idx] || {};
      const type = item.querySelector('[data-featured-field="type"]')?.innerText.trim() || '';
      const content = item.querySelector('[data-featured-field="content"]')?.innerText.trim() || '';
      lastData.featured[idx]['Post type'] = type;
      lastData.featured[idx].Content = content;
    });
  }

  // activity
  const activityItems = outputEl.querySelectorAll('[data-activity-index]');
  if (activityItems && activityItems.length) {
    lastData.activity = lastData.activity || [];
    activityItems.forEach((item) => {
      const idx = Number(item.getAttribute('data-activity-index'));
      lastData.activity[idx] = lastData.activity[idx] || {};
      const type = item.querySelector('[data-activity-field="type"]')?.innerText.trim() || '';
      const content = item.querySelector('[data-activity-field="content"]')?.innerText.trim() || '';
      lastData.activity[idx]['Post type'] = type;
      lastData.activity[idx].Content = content;
    });
  }
}

// Wire up UI controls
extractBtn.addEventListener("click", requestData);
downloadJsonBtn.addEventListener("click", downloadJson);
saveNotionBtn.addEventListener("click", saveToNotion);
connectNotionBtn.addEventListener('click', connectToNotion);
notionDbSelect.addEventListener('change', (e) => { persistSelectedDatabase(e.target.value); });

if (persistentCloseBtn) {
  persistentCloseBtn.addEventListener('click', () => window.close());
}

loadNotionSettings();
