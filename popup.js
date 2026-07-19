const extractBtn = document.getElementById("extractBtn");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");

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

// Wire up the two remaining UI controls
extractBtn.addEventListener("click", requestData);
downloadJsonBtn.addEventListener("click", downloadJson);
