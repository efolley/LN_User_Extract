const express = require('express');
const router = express.Router();
const { get, all, run } = require('./db');
const { decrypt } = require('./crypto');
const notionClient = require('./notion-server-client');
const path = require('path');

async function authenticate(req, res, next) {
  try {
    const auth = req.get('Authorization') || '';
    const token = (auth.startsWith('Bearer ') && auth.slice(7)) || req.query.client_token || null;
    if (!token) return res.status(401).json({ error: 'Missing Authorization' });
    const user = await get('SELECT * FROM users WHERE client_token = ?', [token]);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

router.use(authenticate);

router.get('/databases', async (req, res) => {
  try {
    const accessEnc = req.user.access_token_encrypted;
    const access = decrypt(accessEnc);
    const list = await notionClient.listDatabases(access);
    // Cache basic list in databases table
    for (const db of list) {
      await run(
        'INSERT INTO databases (user_id, notion_database_id, title, properties_json, last_synced_at) VALUES (?, ?, ?, ?, strftime('%s','now')) ON CONFLICT DO NOTHING',
        [req.user.id, db.id, db.title, null]
      ).catch(() => {});
    }
    res.json({ databases: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

router.get('/database/:id/properties', async (req, res) => {
  try {
    const access = decrypt(req.user.access_token_encrypted);
    const database = await notionClient.getDatabase(access, req.params.id);
    res.json({ properties: database.properties || {}, raw: database });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

router.post('/mapping', async (req, res) => {
  try {
    const { notion_database_id, mapping } = req.body;
    if (!notion_database_id || !mapping) return res.status(400).json({ error: 'missing fields' });
    const exists = await get('SELECT * FROM mappings WHERE user_id = ? AND notion_database_id = ?', [req.user.id, notion_database_id]);
    if (exists) {
      await run('UPDATE mappings SET mapping_json = ?, updated_at = strftime('%s','now') WHERE id = ?', [JSON.stringify(mapping), exists.id]);
    } else {
      await run('INSERT INTO mappings (user_id, notion_database_id, mapping_json) VALUES (?, ?, ?)', [req.user.id, notion_database_id, JSON.stringify(mapping)]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

router.get('/mapping', async (req, res) => {
  try {
    const notion_database_id = req.query.notion_database_id;
    if (!notion_database_id) return res.status(400).json({ error: 'missing database id' });
    const row = await get('SELECT * FROM mappings WHERE user_id = ? AND notion_database_id = ?', [req.user.id, notion_database_id]);
    res.json({ mapping: row ? JSON.parse(row.mapping_json) : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

const pageBuilder = require(path.join('..', 'src', 'notion.js'));

router.post('/save-profile', async (req, res) => {
  try {
    const { notion_database_id, profile } = req.body;
    if (!notion_database_id || !profile) return res.status(400).json({ error: 'missing fields' });

    // Load mapping
    const mappingRow = await get('SELECT * FROM mappings WHERE user_id = ? AND notion_database_id = ?', [req.user.id, notion_database_id]);
    const mapping = mappingRow ? JSON.parse(mappingRow.mapping_json) : null;

    // Build data object for page body using mapping; for now pass profile through to children builder
    // Use pageBuilder.buildCreatePagePayload via a tiny wrapper
    const buildPayload = (dataSourceId, titlePropertyName) => {
      // Map simple properties according to mapping if present
      const data = {};
      if (mapping) {
        // mapping maps scraped keys like 'name' -> Notion property; but our builder expects data.name etc for children
        // We'll keep children content as the raw profile for now; properties/population across database properties is left as extension (or later enhancement)
      }
      data.name = profile.name;
      data.headline = profile.headline;
      data.location = profile.location;
      data.about = profile.about;
      data.experience = profile.experience;
      data.featured = profile.featured;
      data.activity = profile.activity;

      return pageBuilder.buildCreatePagePayload(dataSourceId, titlePropertyName, data);
    };

    const access = decrypt(req.user.access_token_encrypted);
    const page = await notionClient.createPage(access, notion_database_id, buildPayload);

    // Persist profile
    await run('INSERT INTO profiles (user_id, notion_database_id, profile_json, notion_page_url) VALUES (?, ?, ?, ?)', [req.user.id, notion_database_id, JSON.stringify(profile), page.url || `https://www.notion.so/${String(page.id || '').replace(/-/g, '')}`]);

    res.json({ ok: true, page });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

module.exports = router;
