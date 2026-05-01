const axios = require('axios');

const BASE_URL = 'https://api.dropboxapi.com/2';
const CONTENT_URL = 'https://content.dropboxapi.com/2';

function getToken() {
  return process.env.DROPBOX_ACCESS_TOKEN;
}

function buildFolderPath(propertyAddress) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.toLocaleString('en-US', { month: 'long' });
  return `/${year}/${month} ${year}/${propertyAddress}`;
}

function buildFolderUrl(propertyAddress) {
  const token = getToken();
  if (!token || !propertyAddress) return null;
  const folderPath = buildFolderPath(propertyAddress);
  // Create a browsable Dropbox URL from the path
  const encoded = folderPath.replace(/\//g, '/');
  return `https://www.dropbox.com/home${encoded}`;
}

async function listFolder(path) {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await axios.post(
      `${BASE_URL}/files/list_folder`,
      { path, recursive: false },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (err) {
    if (err.response?.status === 409) return null; // folder doesn't exist yet
    console.error('[dropbox] listFolder error:', err.response?.status, JSON.stringify(err.response?.data));
    throw err;
  }
}

async function getFolderContents(propertyAddress) {
  const path = buildFolderPath(propertyAddress);
  return listFolder(path);
}

async function createSharedLink(path) {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await axios.post(
      `${BASE_URL}/sharing/create_shared_link_with_settings`,
      { path, settings: { requested_visibility: 'public' } },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.url;
  } catch (err) {
    // Link may already exist — fetch existing
    if (err.response?.data?.error?.['.tag'] === 'shared_link_already_exists') {
      const existing = err.response.data.error.shared_link_already_exists?.metadata?.url;
      if (existing) return existing;
      // Fetch the existing link
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

// Check a folder for new files compared to a known file count
async function checkForNewFiles(propertyAddress, previousCount = 0) {
  const contents = await getFolderContents(propertyAddress);
  if (!contents) return { newFiles: [], totalCount: previousCount };

  const files = contents.entries.filter(e => e['.tag'] === 'file');
  const newFiles = files.slice(previousCount);
  return { newFiles, totalCount: files.length };
}

module.exports = {
  buildFolderPath,
  buildFolderUrl,
  getFolderContents,
  getSharedFolderLink,
  checkForNewFiles,
};
