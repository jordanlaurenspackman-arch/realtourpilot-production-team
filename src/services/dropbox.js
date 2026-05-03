const axios = require('axios');

const BASE_URL = 'https://api.dropboxapi.com/2';

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  // Fall back to static token if refresh token not configured
  if (!refreshToken || !appKey || !appSecret) {
    return process.env.DROPBOX_ACCESS_TOKEN || null;
  }

  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  const creds = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
  const response = await axios.post(
    'https://api.dropbox.com/oauth2/token',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + response.data.expires_in * 1000;
  return cachedToken;
}

function buildFolderPath(propertyAddress) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.toLocaleString('en-US', { month: 'long' });
  return `/${year}/${month} ${year}/${propertyAddress}`;
}

async function listFolder(path) {
  const token = await getToken();
  if (!token) return null;

  try {
    const response = await axios.post(
      `${BASE_URL}/files/list_folder`,
      { path, recursive: false },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return response.data;
  } catch (err) {
    if (err.response?.status === 409) return null; // folder doesn't exist yet
    console.error('[dropbox] listFolder error:', err.response?.status, JSON.stringify(err.response?.data));
    throw err;
  }
}

async function createSharedLink(path) {
  const token = await getToken();
  if (!token) return null;

  try {
    const response = await axios.post(
      `${BASE_URL}/sharing/create_shared_link_with_settings`,
      { path, settings: { requested_visibility: 'public' } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return response.data.url;
  } catch (err) {
    if (err.response?.data?.error?.['.tag'] === 'shared_link_already_exists') {
      const existing = err.response.data.error.shared_link_already_exists?.metadata?.url;
      if (existing) return existing;
      try {
        const listResp = await axios.post(
          `${BASE_URL}/sharing/list_shared_links`,
          { path, direct_only: true },
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );
        return listResp.data.links?.[0]?.url || null;
      } catch { return null; }
    }
    console.error('[dropbox] createSharedLink error:', err.response?.status, JSON.stringify(err.response?.data));
    return null;
  }
}

async function getSharedFolderLink(propertyAddress) {
  const path = buildFolderPath(propertyAddress);
  return createSharedLink(path);
}

async function checkForNewFiles(propertyAddress, previousCount = 0) {
  const contents = await listFolder(buildFolderPath(propertyAddress));
  if (!contents) return { newFiles: [], totalCount: previousCount };

  const files = contents.entries.filter(e => e['.tag'] === 'file');
  const newFiles = files.slice(previousCount);
  return { newFiles, totalCount: files.length };
}

module.exports = {
  buildFolderPath,
  getSharedFolderLink,
  checkForNewFiles,
};
