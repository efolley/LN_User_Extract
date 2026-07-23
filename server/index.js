require('dotenv').config();
const express = require('express');
const path = require('path');
const migrate = require('./migrate');
const { get, all, run } = require('./db');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Expose a safe migration endpoint for local/dev usage (POST only)
app.post('/_migrate', async (req, res) => {
  try {
    await migrate.run();
    res.json({ migrated: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Placeholder: list databases for a user (requires Authorization: Bearer <client_token>)
app.get('/api/databases', async (req, res) => {
  // TODO: authenticate user via client_token header and call Notion with stored tokens
  res.json({ databases: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

module.exports = app;
