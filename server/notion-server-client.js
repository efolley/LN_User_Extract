const NOTION_VERSION = "2025-09-03";

async function notionFetch(token, path, options = {}) {
  const base = "https://api.notion.com/v1";
  const url = base + path;
  const fetchOptions = {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  };
  if (options.body) fetchOptions.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);

  const res = await fetch(url, fetchOptions);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.message || `Notion API error ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function listDatabases(token) {
  // Use the search endpoint to find databases
  const body = await notionFetch(token, "/search", {
    method: "POST",
    body: { filter: { property: "object", value: "database" }, page_size: 100 },
  });
  const results = body.results || [];
  return results.map((db) => ({ id: db.id, title: (db.title || []).map((t) => t.plain_text || '').join('') }));
}

async function getDatabase(token, databaseId) {
  return notionFetch(token, `/databases/${databaseId}`);
}

async function getDataSource(token, dataSourceId) {
  return notionFetch(token, `/data_sources/${dataSourceId}`);
}

async function createPage(token, databaseId, pagePayloadBuilder) {
  // Resolve data source id -> title property name -> build payload -> POST /pages
  const database = await getDatabase(token, databaseId);
  const dataSources = database.data_sources || [];
  if (!dataSources.length) throw new Error('Database has no data sources');
  const dataSourceId = dataSources[0].id;
  const dataSource = await getDataSource(token, dataSourceId);
  const titlePropertyName = Object.entries(dataSource.properties || {}).find(([, v]) => v && v.type === 'title')?.[0];
  if (!titlePropertyName) throw new Error('No title property found on data source');

  const payload = pagePayloadBuilder(dataSourceId, titlePropertyName);

  const page = await notionFetch(token, '/pages', { method: 'POST', body: payload });
  return page;
}

module.exports = { notionFetch, listDatabases, getDatabase, createPage };
