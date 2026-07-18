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
