const extractBtn = document.getElementById("extractBtn");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");
const saveNotionBtn = document.getElementById("saveNotionBtn");
const notionTokenInput = document.getElementById("notionToken");
const notionDatabaseIdInput = document.getElementById("notionDatabaseId");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");

const NOTION_STORAGE_KEY = "notionSettings";

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
  if (settings.token) notionTokenInput.value = settings.token;
  if (settings.databaseId) notionDatabaseIdInput.value = settings.databaseId;
}

async function persistNotionSettings() {
  await chrome.storage.local.set({
    [NOTION_STORAGE_KEY]: {
      token: notionTokenInput.value.trim(),
      databaseId: window.NotionPagePayload.extractNotionId(notionDatabaseIdInput.value),
    },
  });
}

async function saveToNotion() {
  if (!lastData) return;

  const token = notionTokenInput.value.trim();
  const databaseId = window.NotionPagePayload.extractNotionId(notionDatabaseIdInput.value);

  saveNotionBtn.disabled = true;
  setStatus("Saving to Notion...");

  try {
    if (!token || !databaseId) {
      throw new Error("Enter your Notion integration token and database ID first.");
    }
    await persistNotionSettings();
    const pageUrl = await window.NotionClient.saveProfileToNotion(token, databaseId, lastData);
    setStatus(`Saved to Notion: ${pageUrl}`);
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
notionTokenInput.addEventListener("change", persistNotionSettings);
notionDatabaseIdInput.addEventListener("change", persistNotionSettings);

loadNotionSettings();
