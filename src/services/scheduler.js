const cron = require('node-cron');
const { sendMorningDigest, sendWeeklyReport } = require('./reports');

function startScheduler() {
  // Morning digest — weekdays at 8:00 AM
  cron.schedule('0 8 * * 1-5', async () => {
    console.log('[scheduler] Sending morning digest');
    try {
      await sendMorningDigest();
    } catch (err) {
      console.error('[scheduler] Morning digest failed:', err.message);
    }
  });

  // Weekly report — every Monday at 7:00 AM
  cron.schedule('0 7 * * 1', async () => {
    console.log('[scheduler] Sending weekly report');
    try {
      await sendWeeklyReport();
    } catch (err) {
      console.error('[scheduler] Weekly report failed:', err.message);
    }
  });

  console.log('[scheduler] Cron jobs registered (morning digest 8am weekdays, weekly report Monday 7am)');
}

module.exports = { startScheduler };
