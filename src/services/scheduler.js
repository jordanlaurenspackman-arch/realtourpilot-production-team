const cron = require('node-cron');
const { sendMorningDigest, sendWeeklyReport } = require('./reports');
const { listOrders, parseOrderPayload } = require('./aryeo');
const { getDb } = require('../db/database');
const { assignJob } = require('./assignment');
const slackService = require('./slack');
const { checkForNewFiles, getSharedFolderLink, buildFolderPath } = require('./dropbox');

async function pollAryeoOrders() {
  const apiKey = process.env.ARYEO_API_KEY;
  if (!apiKey) return;

  console.log('[scheduler] Polling Aryeo for new orders...');
  const db = getDb();

  try {
    const response = await listOrders(1);
    const orders = response.data || [];

    console.log(`[scheduler] Aryeo returned ${orders.length} orders`);
    if (orders.length > 0) {
      console.log('[scheduler] Sample order keys:', Object.keys(orders[0]).join(', '));
    }

    let newCount = 0;
    for (const order of orders) {
      const jobData = parseOrderPayload({ data: order });
      if (!jobData.aryeo_order_id) continue;

      const existing = db.prepare(`SELECT id FROM jobs WHERE aryeo_order_id = ?`).get(jobData.aryeo_order_id);
      if (existing) continue;

      // Ensure all values are SQLite-safe (null or string only)
      const safe = (v) => (v === null || v === undefined) ? null : String(v);
      const v = {
        aryeo_order_id:   safe(jobData.aryeo_order_id),
        aryeo_listing_id: safe(jobData.aryeo_listing_id),
        client_name:      safe(jobData.client_name),
        client_email:     safe(jobData.client_email),
        service_type:     safe(jobData.service_type),
        property_address: safe(jobData.property_address),
        scheduled_at:     safe(jobData.scheduled_at),
      };
      console.log('[scheduler] Inserting job (sanitized):', JSON.stringify(v));

      const result = db.prepare(`
        INSERT INTO jobs (aryeo_order_id, aryeo_listing_id, client_name, client_email, service_type, property_address, scheduled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(v.aryeo_order_id, v.aryeo_listing_id, v.client_name, v.client_email, v.service_type, v.property_address, v.scheduled_at);

      const jobId = result.lastInsertRowid;
      const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);

      try {
        const editor = assignJob(jobId);
        if (editor) {
          // Get Dropbox folder link to include in notification
          let dropboxUrl = null;
          if (job.property_address) {
            dropboxUrl = await getSharedFolderLink(job.property_address);
            const folderPath = buildFolderPath(job.property_address);
            db.prepare(`
              INSERT OR REPLACE INTO job_dropbox (job_id, folder_path, file_count, last_checked_at)
              VALUES (?, ?, 0, datetime('now'))
            `).run(jobId, folderPath);
          }
          await slackService.notifyEditorAssigned(job, editor, dropboxUrl);
        }
      } catch (err) {
        console.error('[scheduler] Assignment error:', err.message);
      }

      newCount++;
    }

    console.log(`[scheduler] Aryeo poll complete — ${newCount} new order(s) imported`);
  } catch (err) {
    console.error('[scheduler] Aryeo poll failed:', err.message);
  }
}

async function pollDropboxFolders() {
  if (!process.env.DROPBOX_ACCESS_TOKEN) return;

  const db = getDb();
  const jobs = db.prepare(`
    SELECT j.*, jd.folder_path, jd.file_count, e.slack_user_id as editor_slack, e.name as editor_name
    FROM jobs j
    JOIN job_dropbox jd ON jd.job_id = j.id
    JOIN editors e ON e.id = j.assigned_editor_id
    WHERE j.status IN ('assigned', 'in_progress')
  `).all();

  for (const job of jobs) {
    try {
      const { newFiles, totalCount } = await checkForNewFiles(job.property_address, job.file_count);

      if (newFiles.length > 0) {
        db.prepare(`
          UPDATE job_dropbox SET file_count = ?, last_checked_at = datetime('now') WHERE job_id = ?
        `).run(totalCount, job.id);

        const dropboxUrl = await getSharedFolderLink(job.property_address);
        const fileList = newFiles.map(f => `• ${f.name}`).join('\n');

        await slackService.send(
          job.editor_slack || process.env.SLACK_JOBS_CHANNEL || '#production-team',
          `New files uploaded for job #${job.id}`,
          [
            { type: 'header', text: { type: 'plain_text', text: '📂 New Files Uploaded' } },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Job:*\n#${job.id}` },
                { type: 'mrkdwn', text: `*Address:*\n${job.property_address || 'N/A'}` },
              ],
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*${newFiles.length} new file(s):*\n${fileList}` },
            },
            dropboxUrl ? {
              type: 'actions',
              elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open Dropbox Folder' }, url: dropboxUrl, style: 'primary' }],
            } : null,
          ].filter(Boolean)
        );

        console.log(`[dropbox] ${newFiles.length} new file(s) for job #${job.id}`);
      }
    } catch (err) {
      console.error(`[dropbox] Error checking job #${job.id}:`, err.message);
    }
  }
}

function startScheduler() {
  // Poll Aryeo for new orders every hour
  cron.schedule('0 * * * *', pollAryeoOrders);

  // Morning digest — weekdays at 8:00 AM
  cron.schedule('0 8 * * 1-5', async () => {
    console.log('[scheduler] Sending morning digest');
    try { await sendMorningDigest(); }
    catch (err) { console.error('[scheduler] Morning digest failed:', err.message); }
  });

  // Weekly report — every Monday at 7:00 AM
  cron.schedule('0 7 * * 1', async () => {
    console.log('[scheduler] Sending weekly report');
    try { await sendWeeklyReport(); }
    catch (err) { console.error('[scheduler] Weekly report failed:', err.message); }
  });

  // Poll Dropbox for new files every hour
  cron.schedule('30 * * * *', pollDropboxFolders);

  // Run first polls immediately on startup
  pollAryeoOrders();
  pollDropboxFolders();

  console.log('[scheduler] Cron jobs registered (Aryeo poll hourly, Dropbox poll hourly, morning digest 8am weekdays, weekly report Monday 7am)');
}

module.exports = { startScheduler, pollAryeoOrders };
