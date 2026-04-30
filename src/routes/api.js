const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { triggerDelivery } = require('../services/aryeo');
const slackService = require('../services/slack');

// GET /api/jobs — list jobs with optional status filter
router.get('/jobs', (req, res) => {
  const db = getDb();
  const { status, editor_id } = req.query;

  let query = `
    SELECT j.*, e.name as editor_name, e.slack_user_id as editor_slack
    FROM jobs j
    LEFT JOIN editors e ON e.id = j.assigned_editor_id
  `;
  const params = [];
  const conditions = [];

  if (status) {
    conditions.push(`j.status = ?`);
    params.push(status);
  }
  if (editor_id) {
    conditions.push(`j.assigned_editor_id = ?`);
    params.push(editor_id);
  }
  if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ` ORDER BY j.updated_at DESC`;

  res.json(db.prepare(query).all(...params));
});

// GET /api/jobs/:id
router.get('/jobs/:id', (req, res) => {
  const db = getDb();
  const job = db.prepare(`
    SELECT j.*, e.name as editor_name
    FROM jobs j LEFT JOIN editors e ON e.id = j.assigned_editor_id
    WHERE j.id = ?
  `).get(req.params.id);

  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});

// POST /api/jobs/:id/approve — approve and trigger Aryeo delivery
router.post('/jobs/:id/approve', async (req, res) => {
  const db = getDb();
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.id);

  if (!job) return res.status(404).json({ error: 'Not found' });
  if (job.status !== 'completed') {
    return res.status(400).json({ error: `Job is ${job.status}, not completed` });
  }

  db.prepare(`
    UPDATE jobs SET status = 'approved', approved_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(job.id);

  // Trigger Aryeo delivery if order ID exists
  if (job.aryeo_order_id) {
    try {
      await triggerDelivery(job.aryeo_order_id);
      db.prepare(`
        UPDATE jobs SET status = 'delivered', delivered_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(job.id);

      const finalJob = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(job.id);
      try {
        await slackService.notifyDelivered(finalJob);
      } catch (_) {}

      return res.json({ success: true, status: 'delivered' });
    } catch (err) {
      console.error('Aryeo delivery error:', err.message);
      // Stay in approved state so the owner can retry
      return res.status(502).json({ error: 'Approved but Aryeo delivery failed', detail: err.message });
    }
  }

  res.json({ success: true, status: 'approved' });
});

// POST /api/jobs/:id/reject — send back for revisions
router.post('/jobs/:id/reject', async (req, res) => {
  const db = getDb();
  const { reason } = req.body;
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.id);

  if (!job) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE jobs
    SET status = 'assigned', rejection_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(reason || null, job.id);

  const editor = job.assigned_editor_id
    ? db.prepare(`SELECT * FROM editors WHERE id = ?`).get(job.assigned_editor_id)
    : null;

  try {
    await slackService.notifyRejected(job, editor, reason);
  } catch (_) {}

  res.json({ success: true });
});

// --- Editors ---

// GET /api/editors
router.get('/editors', (req, res) => {
  const db = getDb();
  res.json(db.prepare(`SELECT * FROM editors ORDER BY name`).all());
});

// POST /api/editors
router.post('/editors', (req, res) => {
  const { name, slack_user_id, email } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO editors (name, slack_user_id, email) VALUES (?, ?, ?)
  `).run(name, slack_user_id || null, email || null);

  res.json(db.prepare(`SELECT * FROM editors WHERE id = ?`).get(result.lastInsertRowid));
});

// PATCH /api/editors/:id
router.patch('/editors/:id', (req, res) => {
  const db = getDb();
  const { name, slack_user_id, email, active } = req.body;
  const editor = db.prepare(`SELECT * FROM editors WHERE id = ?`).get(req.params.id);
  if (!editor) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE editors
    SET name = COALESCE(?, name),
        slack_user_id = COALESCE(?, slack_user_id),
        email = COALESCE(?, email),
        active = COALESCE(?, active)
    WHERE id = ?
  `).run(name ?? null, slack_user_id ?? null, email ?? null, active ?? null, req.params.id);

  res.json(db.prepare(`SELECT * FROM editors WHERE id = ?`).get(req.params.id));
});

// POST /api/jobs — create a manual job (for jobs not coming from Aryeo)
router.post('/jobs', (req, res) => {
  const db = getDb();
  const { client_name, client_email, service_type, property_address, scheduled_at, notes } = req.body;

  const result = db.prepare(`
    INSERT INTO jobs (client_name, client_email, service_type, property_address, scheduled_at, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(client_name || null, client_email || null, service_type || null, property_address || null, scheduled_at || null, notes || null);

  res.json(db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(result.lastInsertRowid));
});

// POST /api/jobs/:id/assign — manually reassign a job
router.post('/jobs/:id/assign', async (req, res) => {
  const db = getDb();
  const { editor_id } = req.body;
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });

  const editor = db.prepare(`SELECT * FROM editors WHERE id = ?`).get(editor_id);
  if (!editor) return res.status(404).json({ error: 'Editor not found' });

  db.prepare(`
    UPDATE jobs SET assigned_editor_id = ?, status = 'assigned', updated_at = datetime('now')
    WHERE id = ?
  `).run(editor_id, job.id);

  db.prepare(`INSERT INTO job_assignments (job_id, editor_id) VALUES (?, ?)`).run(job.id, editor_id);

  const updatedJob = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(job.id);
  try {
    await slackService.notifyEditorAssigned(updatedJob, editor);
  } catch (_) {}

  res.json(updatedJob);
});

// GET /api/stats — summary counts for the morning dashboard widget
router.get('/stats', (req, res) => {
  const db = getDb();
  const statuses = ['new', 'assigned', 'in_progress', 'completed', 'approved', 'delivered'];
  const stats = {};
  statuses.forEach(s => {
    stats[s] = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = ?`).get(s).c;
  });
  stats.total = Object.values(stats).reduce((a, b) => a + b, 0);

  const today = new Date().toISOString().split('T')[0];
  stats.delivered_today = db.prepare(
    `SELECT COUNT(*) as c FROM jobs WHERE status = 'delivered' AND date(delivered_at) = ?`
  ).get(today).c;

  res.json(stats);
});

module.exports = router;
