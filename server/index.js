require('dotenv').config();
const express = require('express');
const path = require('path');
const migrate = require('./migrate');

const authRouter = require('./auth');
const apiRouter = require('./api');

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

// OAuth routes
app.use('/', authRouter);

// API routes (require Authorization)
app.use('/api', apiRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

module.exports = app;
