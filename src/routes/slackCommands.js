const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const slackService = require('../services/slack');

// Slack sends slash commands as URL-encoded form data.
// Bolt handles /slack/events but we expose raw slash commands here
// so the app can be deployed without Socket Mode.
// Mount AFTER express.urlencoded() middleware.

function requireJobId(text) {
  const id = parseInt((text || '').trim(), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// /job-done <job_id> [optional notes]
router.post('/job-done', async (req, res) => {
  const { text, user_id, user_name } = req.body;
  const parts = (text || '').trim().split(/\s+/);
  const jobId = requireJobId(parts[0]);

  if (!jobId) {
    return res.json({ response_type: 'ephemeral', text: 'Usage: `/job-done <job_id> [optional notes]`' });
  }

  const db = getDb();
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);

  if (!job) {
    return res.json({ response_type: 'ephemeral', text: `Job #${jobId} not found.` });
  }

  // Verify the editor owns the job (by Slack user ID)
  const editor = job.assigned_editor_id
    ? db.prepare(`SELECT * FROM editors WHERE id = ?`).get(job.assigned_editor_id)
    : null;

  if (editor && editor.slack_user_id && editor.slack_user_id !== user_id) {
    return res.json({
      response_type: 'ephemeral',
      text: `Job #${jobId} is assigned to ${editor.name}, not you.`,
    });
  }

  if (['approved', 'delivered'].includes(job.status)) {
    return res.json({
      response_type: 'ephemeral',
      text: `Job #${jobId} is already ${job.status} — no changes needed.`,
    });
  }

  const notes = parts.slice(1).join(' ') || null;

  db.prepare(`
    UPDATE jobs
    SET status = 'completed', notes = COALESCE(?, notes), completed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(notes, jobId);

  const updatedJob = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);

  try {
    await slackService.notifyQcReady(updatedJob, editor);
  } catch (err) {
    console.error('QC notification error:', err.message);
  }

  res.json({
    response_type: 'in_channel',
    text: `:white_check_mark: Job #${jobId} marked complete by <@${user_id}>. Sent to QC queue.`,
  });
});

// /job-status <job_id>
router.post('/job-status', async (req, res) => {
  const { text } = req.body;
  const jobId = requireJobId(text);

  if (!jobId) {
    return res.json({ response_type: 'ephemeral', text: 'Usage: `/job-status <job_id>`' });
  }

  const db = getDb();
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);

  if (!job) {
    return res.json({ response_type: 'ephemeral', text: `Job #${jobId} not found.` });
  }

  const editor = job.assigned_editor_id
    ? db.prepare(`SELECT name FROM editors WHERE id = ?`).get(job.assigned_editor_id)
    : null;

  res.json({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Job #${jobId} Status*` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Status:*\n${job.status}` },
          { type: 'mrkdwn', text: `*Editor:*\n${editor?.name || 'Unassigned'}` },
          { type: 'mrkdwn', text: `*Client:*\n${job.client_name || 'N/A'}` },
          { type: 'mrkdwn', text: `*Address:*\n${job.property_address || 'N/A'}` },
        ],
      },
    ],
  });
});

// /my-jobs — list open jobs for the calling editor
router.post('/my-jobs', async (req, res) => {
  const { user_id } = req.body;
  const db = getDb();

  const editor = db.prepare(`SELECT * FROM editors WHERE slack_user_id = ?`).get(user_id);
  if (!editor) {
    return res.json({
      response_type: 'ephemeral',
      text: `You're not registered as an editor yet. Ask your admin to add you.`,
    });
  }

  const jobs = db.prepare(`
    SELECT * FROM jobs
    WHERE assigned_editor_id = ? AND status NOT IN ('delivered')
    ORDER BY created_at DESC
  `).all(editor.id);

  if (!jobs.length) {
    return res.json({ response_type: 'ephemeral', text: 'You have no open jobs. :tada:' });
  }

  const lines = jobs.map(j => `• *#${j.id}* — ${j.property_address || j.client_name || 'Untitled'} [\`${j.status}\`]`);

  res.json({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Your open jobs (${jobs.length}):*\n${lines.join('\n')}` },
      },
    ],
  });
});

module.exports = router;
