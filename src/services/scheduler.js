const cron = require('node-cron');
const { sendMorningDigest, sendWeeklyReport } = require('./reports');
const { listOrders, parseOrderPayload } = require('./aryeo');
const { getDb } = require('../db/database');
const { assignJob } = require('./assignment');
const slackService = require('./slack');

async function pollAryeoOrders() {
  const apiKey = process.env.ARYEO_API_KEY;
  if (!apiKey) return;

  console.log('[scheduler] Polling Aryeo for new orders...');
  const db = getDb();

  try {
    const response = await listOrders(1);
    const orders = response.data || [];

    let newCount = 0;
    for (const order of orders) {
      const jobData = parseOrderPayload({ data: order });
      if (!jobData.aryeo_order_id) continue;

      const existing = db.prepare(`SELECT id FROM jobs WHERE aryeo_order_id = ?`).get(jobData.aryeo_order_id);
      if (existing) continue;

      const result = db.prepare(`
        INSERT INTO jobs (aryeo_order_id, aryeo_listing_id, client_name, client_email, service_type, property_address, scheduled_at)
        VALUES (@aryeo_order_id, @aryeo_listing_id, @client_name, @client_email, @service_type, @property_address, @scheduled_at)
      `).run(jobData);

      const jobId = result.lastInsertRowid;
      const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);

      try {
        const editor = assignJob(jobId);
        if (editor) await slackService.notifyEditorAssigned(job, editor);
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

  // Run first poll immediately on startup
  pollAryeoOrders();

  console.log('[scheduler] Cron jobs registered (Aryeo poll hourly, morning digest 8am weekdays, weekly report Monday 7am)');
}

module.exports = { startScheduler, pollAryeoOrders };
