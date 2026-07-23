/**
 * Thin Notion API client. All payload construction lives in notion.js
 * (pure, unit tested); this file just makes the network calls.
 *
 * As of the 2025-09-03 Notion API version, a database's pages live under
 * one of its "data sources" rather than the database directly, so creating
 * a page takes three calls: resolve the data source, find its title
 * property, then create the page.
 */
(() => {
  const NOTION_VERSION = "2025-09-03";
  const { buildCreatePagePayload, findTitlePropertyName } = window.NotionPagePayload;

  async function notionFetch(token, path, options = {}) {
    const response = await fetch(`https://api.notion.com/v1${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body?.message || `Notion API error (HTTP ${response.status})`);
    }

    return body;
  }

  async function getFirstDataSourceId(token, databaseId) {
    const database = await notionFetch(token, `/databases/${databaseId}`);
    const dataSources = database.data_sources || [];
    if (!dataSources.length) {
      throw new Error("That database has no data sources - double-check the database ID.");
    }
    return dataSources[0].id;
  }

  async function getTitlePropertyName(token, dataSourceId) {
    const dataSource = await notionFetch(token, `/data_sources/${dataSourceId}`);
    const propertyName = findTitlePropertyName(dataSource.properties);
    if (!propertyName) {
      throw new Error("Could not find a title property on that database.");
    }
    return propertyName;
  }

  /** Creates one new page in the given database for `data` (the extracted profile JSON). Returns the new page's URL. */
  async function saveProfileToNotion(token, databaseId, data) {
    if (!token) throw new Error("Missing Notion integration token.");
    if (!databaseId) throw new Error("Missing Notion database ID.");

    const dataSourceId = await getFirstDataSourceId(token, databaseId);
    const titlePropertyName = await getTitlePropertyName(token, dataSourceId);
    const payload = buildCreatePagePayload(dataSourceId, titlePropertyName, data);

    const page = await notionFetch(token, "/pages", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return page.url || `https://www.notion.so/${String(page.id || "").replace(/-/g, "")}`;
  }

  window.NotionClient = { saveProfileToNotion };
})();
