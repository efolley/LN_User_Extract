const express = require('express');
const crypto = require('crypto');
const fetch = global.fetch;
const { run } = require('./db');
const { encrypt } = require('./crypto');

const router = express.Router();

// In-memory state store for simplicity. For production, persist states (or use signed state values).
const STATE_STORE = new Map();

function genState() {
  return crypto.randomBytes(16).toString('hex');
}

function genClientToken() {
  return crypto.randomBytes(32).toString('hex');
}

router.get('/auth/start', (req, res) => {
  const state = genState();
  STATE_STORE.set(state, Date.now());

  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) return res.status(500).send('NOTION_CLIENT_ID not configured');

  const base = req.protocol + '://' + req.get('host');
  const redirectUri = `${base}/auth/callback`;

  const params = new URLSearchParams({
    owner: 'user',
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });

  const url = `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
  res.redirect(url);
});

router.get('/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || !STATE_STORE.has(state)) {
      return res.status(400).send('Invalid or missing state/code');
    }
    STATE_STORE.delete(state);

    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(500).send('OAuth not configured on server');

    const base = req.protocol + '://' + req.get('host');
    const redirectUri = `${base}/auth/callback`;

    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
    });

    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      console.error('Token exchange failed', tokenBody);
      return res.status(500).send('Token exchange failed');
    }

    const accessToken = tokenBody.access_token;
    const refreshToken = tokenBody.refresh_token || null;
    const workspaceId = tokenBody.workspace_id || null;

    const clientToken = genClientToken();
    const encAccess = encrypt(accessToken);
    const encRefresh = refreshToken ? encrypt(refreshToken) : null;

    // Create a user row
    await run(
      'INSERT INTO users (notion_user_id, client_token, access_token_encrypted, refresh_token_encrypted) VALUES (?, ?, ?, ?)',
      [workspaceId, clientToken, encAccess, encRefresh]
    );

    // Return an HTML page that posts the token to window.opener (so the extension popup can capture it)
    res.set('Content-Type', 'text/html');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Notion connected</title></head><body>
      <h2>Notion connected</h2>
      <p>You may now return to the extension. If the extension opened this window it will receive the token automatically.</p>
      <pre id="token" style="display:none">${clientToken}</pre>
      <script>
        (function() {
          try {
            var token = ${JSON.stringify(clientToken)};
            if (window.opener && window.opener.postMessage) {
              // Send to the opener window and then close
              window.opener.postMessage({ type: 'NOTION_CLIENT_TOKEN', token: token }, '*');
              setTimeout(function() { window.close(); }, 500);
            } else {
              // Fallback: show token for manual copy
              document.getElementById('token').style.display = 'block';
            }
          } catch (e) {
            document.getElementById('token').style.display = 'block';
          }
        })();
      </script>
      <p>If the window did not close automatically, you can close it now.</p>
      </body></html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
