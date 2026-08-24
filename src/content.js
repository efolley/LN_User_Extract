/**
 * Content script: all DOM traversal for the LinkedIn Profile Extractor.
 *
 * Text parsing itself lives in parser.js (loaded into this same execution
 * context before this file - see popup.js's injection order) so that logic
 * can be unit tested outside a browser. This file's job is narrower: find
 * the right elements on the page, pull out their text/links, and hand them
 * to the parser functions.
 */
(() => {
  if (window.__profileExtractorLoaded) return;
  window.__profileExtractorLoaded = true;

  const {
    clean,
    toLines,
    isBoilerplateLine,
    dedupeRepeatedText,
    isEmploymentTypeLine,
    isShowAllText,
    isReshareText,
    stripAfterDot,
    parseExperienceEntry,
    extractSectionLines,
    stripAuthorHeader,
    parseFeaturedEntry,
    parseActivityEntry,
  } = window.ProfileExtractorParser;

  function getMainNode() {
    return document.querySelector("main") || document.body;
  }

  function getBodyLines() {
    return toLines(getMainNode()?.innerText || "");
  }

  function getTopCardNode() {
    return (
      document.querySelector('main [class*="pv-text-details__left-panel"]') ||
      document.querySelector("main h1")?.closest("section") ||
      document.querySelector("h1")?.closest("section") ||
      document.querySelector("main section") ||
      document.querySelector("main")
    );
  }

  function getTopCardLines() {
    const node = getTopCardNode();
    return toLines(node?.innerText || node?.textContent || "");
  }

  function clickLikeUser(el) {
    if (!el) return false;
    try {
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      el.click();
      return true;
    } catch {
      return false;
    }
  }

  function getSectionContainer(sectionName) {
    const root = getMainNode();
    const heading = Array.from(root.querySelectorAll("h1, h2, h3, span, div")).find(
      (el) => clean(el.textContent).toLowerCase() === sectionName.toLowerCase()
    );
    if (!heading) return null;
    return heading.closest("section") || heading.parentElement || heading;
  }

  function getExperienceSection() {
    const anchor = document.getElementById("experience");
    if (anchor) {
      const section = anchor.closest("section");
      if (section) return section;
    }

    const root = getMainNode();
    const heading = Array.from(root.querySelectorAll("h1, h2, h3")).find((el) =>
      clean(el.textContent).toLowerCase().includes("experience")
    );
    if (!heading) return null;
    return heading.closest("section") || heading.parentElement || heading;
  }

  function isMoreButton(button) {
    const label = clean(button.innerText || button.getAttribute("aria-label") || button.textContent).toLowerCase();
    if (!label.includes("more")) return false;
    if (label.includes("action") || label.includes("option") || label.includes("menu")) return false;
    return true;
  }

  function expandSection(sectionName) {
    const section = sectionName === "Experience" ? getExperienceSection() : getSectionContainer(sectionName);
    if (!section) return false;

    const candidates = Array.from(section.querySelectorAll("button, [role='button'], a, span, div"));
    const moreButton = candidates.find(isMoreButton);

    return clickLikeUser(moreButton);
  }

  function expandAllMoreButtons(section) {
    if (!section) return;
    const candidates = Array.from(section.querySelectorAll("button, [role='button'], a, span, div"));
    candidates.filter(isMoreButton).forEach((button) => clickLikeUser(button));
  }

  function extractSectionText(startLabel) {
    return clean(extractSectionLines(getBodyLines(), startLabel).join(" "));
  }

  function extractName() {
    const h1 = clean(document.querySelector("h1")?.textContent || "");
    if (h1) return h1;

    const lines = getTopCardLines();
    return lines.find((line) => !isBoilerplateLine(line)) || "";
  }

  function extractHeadline() {
    const name = extractName();
    const lines = getTopCardLines();
    const nameIndex = lines.findIndex((line) => line === name);
    const searchLines = nameIndex === -1 ? lines : lines.slice(nameIndex + 1);
    return searchLines.find((line) => !isBoilerplateLine(line) && line !== name) || "";
  }

  function extractLocation() {
    const name = extractName();
    const headline = extractHeadline();
    const lines = getTopCardLines();

    const nameIndex = lines.findIndex((line) => line === name);
    const afterName = nameIndex === -1 ? 0 : nameIndex + 1;
    const headlineIndex = lines.findIndex((line, index) => index >= afterName && line === headline);
    const startIndex = headlineIndex === -1 ? afterName : headlineIndex + 1;

    const candidates = lines.slice(startIndex);
    return candidates.find((line) => !isBoilerplateLine(line) && line !== name && line !== headline) || "";
  }

  function getTopLevelListItems(section) {
    const items = Array.from(section.querySelectorAll("li"));
    const topLevel = items.filter((li) => !items.some((other) => other !== li && other.contains(li)));
    if (topLevel.length) return topLevel;

    const list = section.querySelector("ul, ol");
    if (list) {
      return Array.from(list.children).filter((child) => child.nodeType === 1);
    }

    return [];
  }

  function collectLinks(el) {
    const links = Array.from(el.querySelectorAll("a[href]"))
      .map((a) => a.href)
      .filter((href) => href && !href.startsWith("javascript:"));
    return Array.from(new Set(links));
  }

  function getCompanyNameFromScope(scope) {
    if (!scope) return "";

    const logoLabel = Array.from(scope.querySelectorAll("[aria-label]")).find((el) =>
      /logo$/i.test(clean(el.getAttribute("aria-label") || ""))
    );
    if (logoLabel) {
      return clean(logoLabel.getAttribute("aria-label")).replace(/\s*logo$/i, "");
    }

    const link = scope.querySelector("a[href*='/company/']");
    if (link) {
      const text = clean(link.innerText || link.textContent || "");
      if (text) return text;
    }

    return "";
  }

  function getGroupCompanyName(block) {
    const list = block.closest("ul");
    return getCompanyNameFromScope(list?.previousElementSibling);
  }

  function getExperienceCards(section) {
    const cards = Array.from(section.querySelectorAll('[componentkey^="entity-collection-item"]'));
    return cards.filter((card) => !cards.some((other) => other !== card && other.contains(card)));
  }

  function extractEntriesFromListItems(section) {
    const blocks = getTopLevelListItems(section);
    const entries = [];

    blocks.forEach((block) => {
      try {
        const nestedItems = Array.from(block.querySelectorAll("li"));

        if (nestedItems.length > 0) {
          const clone = block.cloneNode(true);
          clone.querySelectorAll("li").forEach((node) => node.remove());
          const headerLines = toLines(clone.innerText || clone.textContent || "").filter(
            (line) => !isEmploymentTypeLine(line)
          );
          const companyLine = headerLines.find((line) => !isBoilerplateLine(line));
          const company = getGroupCompanyName(block) || (companyLine ? stripAfterDot(companyLine) : "");

          nestedItems.forEach((item) => {
            const lines = toLines(item.innerText || item.textContent || "");
            const links = collectLinks(item);
            entries.push(parseExperienceEntry(lines, links, company));
          });
        } else {
          const lines = toLines(block.innerText || block.textContent || "");
          const links = collectLinks(block);
          const company = getGroupCompanyName(block);
          entries.push(parseExperienceEntry(lines, links, company));
        }
      } catch {
        // Skip entries that don't match the expected shape rather than failing the whole extraction.
      }
    });

    return entries;
  }

  function extractEntriesFromCards(section) {
    const cards = getExperienceCards(section);
    const entries = [];

    cards.forEach((card) => {
      try {
        const list = card.querySelector("ul");
        const positions = list ? Array.from(list.children).filter((child) => child.nodeType === 1) : [];

        if (positions.length > 0) {
          const company = getCompanyNameFromScope(list.previousElementSibling) || getCompanyNameFromScope(card);

          positions.forEach((item) => {
            const lines = toLines(item.innerText || item.textContent || "");
            const links = collectLinks(item);
            entries.push(parseExperienceEntry(lines, links, company));
          });
        } else {
          const company = getCompanyNameFromScope(card);
          const lines = toLines(card.innerText || card.textContent || "");
          const links = collectLinks(card);
          entries.push(parseExperienceEntry(lines, links, company));
        }
      } catch {
        // Skip cards that don't match the expected shape rather than failing the whole extraction.
      }
    });

    return entries;
  }

  function extractExperienceEntries() {
    const section = getExperienceSection();
    if (!section) return [];

    const cardEntries = extractEntriesFromCards(section);
    if (cardEntries.length) return cardEntries;

    return extractEntriesFromListItems(section);
  }

  function getPostItemNodes(sectionName) {
    const section = getSectionContainer(sectionName);
    if (!section) return [];

    const items = Array.from(section.querySelectorAll("li"));
    const pool = items.length ? items : Array.from(section.children);

    return pool
      .filter((item) => {
        const text = clean(item.innerText || item.textContent || "");
        if (!text) return false;
        if (text.toLowerCase() === sectionName.toLowerCase()) return false;
        if (isShowAllText(text)) return false;
        return true;
      })
      .slice(0, 5);
  }

  function extractFeaturedItems() {
    return getPostItemNodes("Featured").map((item) => {
      const text = clean(item.innerText || item.textContent || "");
      return parseFeaturedEntry(text);
    });
  }

  function extractActivityItems() {
    return getPostItemNodes("Activity").map((item) => {
      const rawText = clean(item.innerText || item.textContent || "");
      let nestedText = "";

      if (isReshareText(rawText)) {
        const bodyText = stripAuthorHeader(rawText);
        // A reshare typically embeds the original post as a distinct nested
        // sub-container inside the reposting person's own activity item.
        const nestedCard = Array.from(item.querySelectorAll("article, section, div")).find((node) => {
          if (node === item) return false;
          const nodeText = clean(node.innerText || node.textContent || "");
          return nodeText && nodeText.length >= bodyText.length * 0.4 && nodeText.length < bodyText.length;
        });
        if (nestedCard) {
          nestedText = clean(nestedCard.innerText || nestedCard.textContent || "");
        }
      }

      return parseActivityEntry(rawText, nestedText);
    });
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const SERVER_ORIGIN = 'http://localhost:3000';

  function escapeHtml(text) {
    return String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /* ------------------ In-page persistent panel ------------------ */
  function createStyle() {
    const id = 'ln-panel-styles';
    if (document.getElementById(id)) return;
    const css = `
      #ln-persistent-panel { position: fixed; right: 18px; top: 60px; width: 420px; max-height: 80vh; overflow: auto; z-index: 2147483647; background: #fff; color: #000; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
      #ln-persistent-panel .panel-header { padding: 10px 12px; background: #001; color: #fff; position: sticky; top: 0; display:flex; align-items:center; justify-content:space-between; }
      #ln-persistent-panel .panel-body { padding: 12px; }
      #ln-persistent-panel .panel-controls { display:flex; gap:8px; margin-bottom:8px; }
      #ln-persistent-panel .field { margin-bottom:8px; }
      #ln-persistent-panel .field h4 { margin:0 0 4px; font-size:12px; }
      #ln-persistent-panel [contenteditable] { padding:6px 8px; border:1px solid #d0d0d0; border-radius:6px; background:#fafafa; }
      #ln-persistent-panel .close-x { background:transparent; border:0; color:#fff; font-size:18px; cursor:pointer; }
    `;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }

  function createOrUpdatePanel(data) {
    createStyle();
    let panel = document.getElementById('ln-persistent-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'ln-persistent-panel';
      panel.innerHTML = `
        <div class="panel-header"><div>LN User Extract</div><button class="close-x" aria-label="Close">×</button></div>
        <div class="panel-body">
          <div class="panel-controls">
            <button id="ln-panel-extract">Extract</button>
            <button id="ln-panel-copy">Copy all</button>
            <button id="ln-panel-save">Save profile</button>
            <button id="ln-panel-save-notion">Save to Notion</button>
          </div>
          <div id="ln-panel-output"></div>
        </div>
      `;
      document.body.appendChild(panel);

      panel.querySelector('.close-x').addEventListener('click', () => panel.remove());
      panel.querySelector('#ln-panel-extract').addEventListener('click', async () => {
        const res = await extractProfileData();
        renderPanelOutput(res);
      });
      panel.querySelector('#ln-panel-save').addEventListener('click', () => {
        // request background to download with saveAs
        syncPanelEditsToData();
        const out = window.lnPanelCurrentData || {};
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_FILE', filename: 'ln-user-extract-profile.json', content: JSON.stringify(out, null, 2) });
      });
      panel.querySelector('#ln-panel-copy').addEventListener('click', async () => {
        syncPanelEditsToData();
        const out = window.lnPanelCurrentData || {};
        const formatted = formatDataForCopy(out);
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(formatted);
          } else {
            const ta = document.createElement('textarea');
            ta.value = formatted;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
          }
          // save to local storage as cache
          try {
            chrome.storage.local.set({ ln_copy_cache: { content: formatted, timestamp: Date.now() } });
          } catch (e) {
            // ignore storage failure
          }
          alert('Profile copied to clipboard and saved to copy cache.');
        } catch (err) {
          alert('Copy failed: ' + (err && err.message ? err.message : err));
        }
      });
      panel.querySelector('#ln-panel-save-notion').addEventListener('click', async () => {
        syncPanelEditsToData();
        const out = window.lnPanelCurrentData || {};
        // try to get token from storage and POST to server
        chrome.storage.local.get('notionSettings', async (stored) => {
          const settings = stored['notionSettings'] || {};
          const token = settings.client_token;
          const db = settings.databaseId;
          if (!token) return alert('Not connected to Notion');
          if (!db) return alert('No Notion database selected');
          try {
            const res = await fetch(`${SERVER_ORIGIN}/api/save-profile`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ notion_database_id: db, profile: out }) });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || 'Save failed');
            alert('Saved to Notion');
          } catch (err) { alert('Notion save failed: ' + err.message); }
        });
      });
    }

    // render output
    renderPanelOutput(data);
  }

  function renderPanelOutput(data) {
    window.lnPanelCurrentData = data || {};
    const out = document.getElementById('ln-panel-output');
    if (!out) return;
    const make = (label, key, value) => `<div class="field"><h4>${label}</h4><div data-key="${key}" contenteditable>${escapeHtml(value || '')}</div></div>`;
    let html = '';
    html += make('URL','url', data.url);
    html += make('Email','email', data.email || '');
    html += make('Name','name', data.name);
    html += make('Headline','headline', data.headline);
    html += make('Location','location', data.location);
    html += `<div class="field"><h4>About</h4><div data-key="about" contenteditable>${escapeHtml(data.about || '')}</div></div>`;
    html += `<h4>Experience</h4>`;
    if (Array.isArray(data.experience) && data.experience.length) {
      data.experience.forEach((e, idx) => {
        html += `<div class="field"><div><strong>${escapeHtml(e['Company name'] || '')} - ${escapeHtml(e.Title || '')}</strong></div><div data-exp-index="${idx}">`;
        html += `<div contenteditable data-exp-field="company">${escapeHtml(e['Company name'] || '')}</div>`;
        html += `<div contenteditable data-exp-field="title">${escapeHtml(e.Title || '')}</div>`;
        html += `<div contenteditable data-exp-field="content">${escapeHtml(e.Content || '')}</div>`;
        html += `<div contenteditable data-exp-field="location">${escapeHtml(e.Location || '')}</div>`;
        html += `</div></div>`;
      });
    }

    // Featured
    html += `<h4>Featured</h4>`;
    if (Array.isArray(data.featured) && data.featured.length) {
      data.featured.forEach((f, idx) => {
        html += `<div class="field" data-featured-index="${idx}"><div contenteditable data-featured-field="type">${escapeHtml(f['Post type'] || '')}</div><div contenteditable data-featured-field="content">${escapeHtml(f.Content || '')}</div></div>`;
      });
    }

    // Activity
    html += `<h4>Activity</h4>`;
    if (Array.isArray(data.activity) && data.activity.length) {
      data.activity.forEach((a, idx) => {
        html += `<div class="field" data-activity-index="${idx}"><div contenteditable data-activity-field="type">${escapeHtml(a['Post type'] || '')}</div><div contenteditable data-activity-field="content">${escapeHtml(a.Content || '')}</div></div>`;
      });
    }

    // Notes
    html += `<h4>Notes</h4>`;
    html += `<div class="field"><div data-key="notes" contenteditable>${escapeHtml(data.notes || '')}</div></div>`;

    out.innerHTML = html;
  }

  function formatDataForCopy(data) {
    const lines = [];
    lines.push(`URL: ${data.url || ''}`);
    lines.push(`Name: ${data.name || ''}`);
    lines.push(`Headline: ${data.headline || ''}`);
    lines.push(`Location: ${data.location || ''}`);
    lines.push(`About: ${data.about || ''}`);
    lines.push('Experience:');
    if (Array.isArray(data.experience) && data.experience.length) {
      data.experience.forEach((e) => {
        const company = e['Company name'] || '';
        const title = e.Title || '';
        lines.push(`${company} - ${title}:`);
        if (e.Content) lines.push(`${e.Content}`);
        if (e.Location) lines.push(`Location: ${e.Location}`);
        lines.push('');
      });
    }
    lines.push('Featured:');
    if (Array.isArray(data.featured) && data.featured.length) {
      data.featured.forEach((f) => {
        lines.push(`${f['Post type'] || ''}: ${f.Content || ''}`);
      });
    }
    lines.push('Activity:');
    if (Array.isArray(data.activity) && data.activity.length) {
      data.activity.forEach((a) => {
        lines.push(`${a['Post type'] || ''}: ${a.Content || ''}`);
      });
    }
    lines.push(`Notes: ${data.notes || ''}`);
    return lines.join('\n');
  }

  function syncPanelEditsToData() {
    const data = window.lnPanelCurrentData || {};
    const outEl = document.getElementById('ln-panel-output');
    if (!outEl) return data;
    const topKeys = ['url','email','name','headline','location','about','notes'];
    topKeys.forEach(k => {
      const el = outEl.querySelector(`[data-key="${k}"]`);
      if (el) data[k] = el.innerText.trim();
    });
    const expEls = outEl.querySelectorAll('[data-exp-index]');
    if (expEls.length) {
      data.experience = data.experience || [];
      expEls.forEach((container) => {
        const idx = Number(container.getAttribute('data-exp-index'));
        data.experience[idx] = data.experience[idx] || {};
        data.experience[idx]['Company name'] = (container.querySelector('[data-exp-field="company"]')?.innerText || '').trim();
        data.experience[idx].Title = (container.querySelector('[data-exp-field="title"]')?.innerText || '').trim();
        data.experience[idx].Content = (container.querySelector('[data-exp-field="content"]')?.innerText || '').trim();
        data.experience[idx].Location = (container.querySelector('[data-exp-field="location"]')?.innerText || '').trim();
      });
    }
    const featuredEls = outEl.querySelectorAll('[data-featured-index]');
    if (featuredEls.length) {
      data.featured = data.featured || [];
      featuredEls.forEach((container) => {
        const idx = Number(container.getAttribute('data-featured-index'));
        data.featured[idx] = data.featured[idx] || {};
        data.featured[idx]['Post type'] = (container.querySelector('[data-featured-field="type"]')?.innerText || '').trim();
        data.featured[idx].Content = (container.querySelector('[data-featured-field="content"]')?.innerText || '').trim();
      });
    }
    const activityEls = outEl.querySelectorAll('[data-activity-index]');
    if (activityEls.length) {
      data.activity = data.activity || [];
      activityEls.forEach((container) => {
        const idx = Number(container.getAttribute('data-activity-index'));
        data.activity[idx] = data.activity[idx] || {};
        data.activity[idx]['Post type'] = (container.querySelector('[data-activity-field="type"]')?.innerText || '').trim();
        data.activity[idx].Content = (container.querySelector('[data-activity-field="content"]')?.innerText || '').trim();
      });
    }
    window.lnPanelCurrentData = data;
    return data;
  }


  async function extractProfileData() {
    expandSection("About");
    expandSection("Experience");
    await wait(250);

    try {
      const experienceSection = getExperienceSection();
      experienceSection?.scrollIntoView({ block: "start" });
    } catch {
      // Ignore - best-effort only.
    }
    await wait(400);

    try {
      expandAllMoreButtons(getExperienceSection());
    } catch {
      // Ignore - expanding truncated descriptions is best-effort only.
    }
    await wait(250);

    let experience = [];
    try {
      experience = extractExperienceEntries().slice(0, 4);
    } catch {
      experience = [];
    }

    let featured = [];
    try {
      featured = extractFeaturedItems();
    } catch {
      featured = [];
    }

    let activity = [];
    try {
      activity = extractActivityItems();
    } catch {
      activity = [];
    }

    return {
      url: window.location.href,
      name: extractName(),
      headline: extractHeadline(),
      location: extractLocation(),
      about: dedupeRepeatedText(extractSectionText("About")),
      experience,
      featured,
      activity,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "EXTRACT_PROFILE_DATA") {
      extractProfileData()
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to extract profile data." }));
      return true;
    }

    if (message?.type === 'SHOW_PERSISTENT_PANEL') {
      try {
        // Create or update a floating persistent panel on the page
        createOrUpdatePanel(message.data || {});
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Failed to show panel' });
      }
      return true;
    }

    if (message?.type === "EXPAND_ABOUT") {
      (async () => {
        try {
          expandSection("About");
          await wait(250);
          const about = dedupeRepeatedText(extractSectionText("About"));
          sendResponse({ ok: true, data: about });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || "Failed to expand About section." });
        }
      })();
      return true;
    }

    if (message?.type === "EXPAND_EXPERIENCE") {
      (async () => {
        try {
          expandSection("Experience");
          await wait(250);
          try {
            getExperienceSection()?.scrollIntoView({ block: "start" });
          } catch {
            // Ignore - best-effort only.
          }
          await wait(400);
          expandAllMoreButtons(getExperienceSection());
          await wait(250);
          const experience = extractExperienceEntries();
          sendResponse({ ok: true, data: experience });
        } catch (error) {
          sendResponse({ ok: false, error: error?.message || "Failed to expand Experience section." });
        }
      })();
      return true;
    }

    if (message?.type === "EXTRACT_FEATURED") {
      try {
        sendResponse({ ok: true, data: extractFeaturedItems() });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || "Failed to extract featured items." });
      }
      return true;
    }

    if (message?.type === "EXTRACT_ACTIVITY") {
      try {
        sendResponse({ ok: true, data: extractActivityItems() });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || "Failed to extract activity items." });
      }
      return true;
    }
  });
})();
