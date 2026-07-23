/**
 * Pure logic for turning extracted profile data into a Notion API request
 * body, plus small string helpers (parsing a pasted database URL/ID).
 *
 * No network calls here - that's src/notion-client.js, which isn't unit
 * tested (it just does fetch() with these payloads). Keeping the payload
 * construction pure means it can be tested the same way as src/parser.js.
 */
(function (global) {
  "use strict";

  const MAX_RICH_TEXT_ITEMS = 100;
  const MAX_RICH_TEXT_CHARS = 2000;
  const MAX_CHILDREN_BLOCKS = 100;

  function chunkText(text, size) {
    const value = String(text || "");
    if (!value) return [""];
    const chunks = [];
    for (let i = 0; i < value.length; i += size) {
      chunks.push(value.slice(i, i + size));
    }
    return chunks;
  }

  /** Notion rich_text arrays cap at 100 items of up to 2000 chars each. */
  function richText(text) {
    let chunks = chunkText(text, MAX_RICH_TEXT_CHARS);

    if (chunks.length > MAX_RICH_TEXT_ITEMS) {
      chunks = chunks.slice(0, MAX_RICH_TEXT_ITEMS);
      const last = chunks[chunks.length - 1];
      const marker = "… [truncated]";
      chunks[chunks.length - 1] = last.slice(0, Math.max(0, last.length - marker.length)) + marker;
    }

    return chunks.map((part) => ({ type: "text", text: { content: part } }));
  }

  function paragraphBlock(text) {
    return { object: "block", type: "paragraph", paragraph: { rich_text: richText(text) } };
  }

  function heading2Block(text) {
    return { object: "block", type: "heading_2", heading_2: { rich_text: richText(text) } };
  }

  function bulletedBlock(text) {
    return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(text) } };
  }

  function bookmarkBlock(url) {
    return { object: "block", type: "bookmark", bookmark: { url: String(url || "") } };
  }

  /** Finds the key of the property whose type is "title" (every Notion data source has exactly one). */
  function findTitlePropertyName(properties) {
    if (!properties) return null;
    const entry = Object.entries(properties).find(([, value]) => value && value.type === "title");
    return entry ? entry[0] : null;
  }

  function buildPageChildren(data) {
    const blocks = [];
    const d = data || {};

    if (d.url) blocks.push(bookmarkBlock(d.url));
    if (d.headline) blocks.push(paragraphBlock(`Headline: ${d.headline}`));
    if (d.location) blocks.push(paragraphBlock(`Location: ${d.location}`));

    if (d.about) {
      blocks.push(heading2Block("About"));
      blocks.push(paragraphBlock(d.about));
    }

    if (Array.isArray(d.experience) && d.experience.length) {
      blocks.push(heading2Block("Experience"));
      d.experience.forEach((entry) => {
        const header = [entry.Title, entry["Company name"], entry.Years].filter(Boolean).join(" — ");
        blocks.push(bulletedBlock(header || "Experience entry"));
        if (entry.Location) blocks.push(paragraphBlock(`Location: ${entry.Location}`));
        if (entry.Content) blocks.push(paragraphBlock(entry.Content));
        if (Array.isArray(entry.Skills) && entry.Skills.length) {
          blocks.push(paragraphBlock(`Skills: ${entry.Skills.join(", ")}`));
        }
      });
    }

    if (Array.isArray(d.featured) && d.featured.length) {
      blocks.push(heading2Block("Featured"));
      d.featured.forEach((item) => {
        blocks.push(bulletedBlock(`[${item["Post type"] || "post"}] ${item.Content || ""}`));
      });
    }

    if (Array.isArray(d.activity) && d.activity.length) {
      blocks.push(heading2Block("Activity"));
      d.activity.forEach((item) => {
        blocks.push(bulletedBlock(`[${item["Post type"] || "post"}] ${item.Content || ""}`));
        if (item["Reshared post info"]) {
          blocks.push(paragraphBlock(`Reshared post: ${item["Reshared post info"]}`));
        }
      });
    }

    return blocks.slice(0, MAX_CHILDREN_BLOCKS);
  }

  function buildCreatePagePayload(dataSourceId, titlePropertyName, data) {
    const propertyName = titlePropertyName || "Name";
    const name = (data && data.name) || "Untitled LinkedIn profile";

    return {
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties: {
        [propertyName]: { title: [{ type: "text", text: { content: name } }] },
      },
      children: buildPageChildren(data),
    };
  }

  /** Accepts a raw database ID (dashed or not) or a full Notion database URL and returns just the ID. */
  function extractNotionId(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";

    const withoutQuery = value.split("?")[0];

    const dashed = withoutQuery.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    if (dashed) return dashed[0];

    const bare = withoutQuery.match(/[0-9a-fA-F]{32}/);
    if (bare) return bare[0];

    return withoutQuery;
  }

  const api = {
    richText,
    paragraphBlock,
    heading2Block,
    bulletedBlock,
    bookmarkBlock,
    findTitlePropertyName,
    buildPageChildren,
    buildCreatePagePayload,
    extractNotionId,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.NotionPagePayload = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
