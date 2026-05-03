#!/usr/bin/env node
// Run: node scripts/dropbox-auth.js
// Gets a long-lived Dropbox refresh token

const https = require('https');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function post(path, body, auth) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const req = https.request({
      hostname: 'api.dropbox.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        ...(auth ? { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const appKey = await ask('Paste your Dropbox App key: ');
  const appSecret = await ask('Paste your Dropbox App secret: ');

  const url = `https://www.dropbox.com/oauth2/authorize?client_id=${appKey.trim()}&response_type=code&token_access_type=offline`;
  console.log('\nOpen this URL in your browser and click Allow:\n');
  console.log(url);
  console.log('');

  const code = await ask('Paste the authorization code shown on screen: ');

  const result = await post('/oauth2/token', {
    code: code.trim(),
    grant_type: 'authorization_code',
    client_id: appKey.trim(),
    client_secret: appSecret.trim(),
  });

  if (result.refresh_token) {
    console.log('\n✅ Success! Run this command to save your credentials:\n');
    console.log(`fly secrets set DROPBOX_APP_KEY=${appKey.trim()} DROPBOX_APP_SECRET=${appSecret.trim()} DROPBOX_REFRESH_TOKEN=${result.refresh_token} -a realtourpilot-production-team`);
  } else {
    console.error('\n❌ Failed:', JSON.stringify(result));
  }
  rl.close();
})();
