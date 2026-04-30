const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { verifyWebhookSignature, parseOrderPayload } = require('../services/aryeo');
const { assignJob } = require('../services/assignment');
const slackService = require('../services/slack');

// Aryeo sends raw body for HMAC verification — must mount with express.raw() before json()
router.post('/aryeo', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['x-aryeo-signature'] || req.headers['x-hub-signature-256'] || '';

  if (!verifyWebhookSignature(req.body, sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const event = payload.event || payload.type || '';

  // Only handle new order events; acknowledge everything else silently
  if (!event.includes('order') && !event.includes('booking') && !event.includes('appointment')) {
    return res.json({ received: true });
  }

  const jobData = parseOrderPayload(payload);
  const db = getDb();

  // Idempotency: skip if we already have this order
  if (jobData.aryeo_order_id) {
    const existing = db.prepare(`SELECT id FROM jobs WHERE aryeo_order_id = ?`).get(jobData.aryeo_order_id);
    if (existing) return res.json({ received: true, job_id: existing.id });
  }

  const result = db.prepare(`
    INSERT INTO jobs (aryeo_order_id, aryeo_listing_id, client_name, client_email, service_type, property_address, scheduled_at)
    VALUES (@aryeo_order_id, @aryeo_listing_id, @client_name, @client_email, @service_type, @property_address, @scheduled_at)
  `).run(jobData);

  const jobId = result.lastInsertRowid;
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);

  let editor = null;
  try {
    editor = assignJob(jobId);
    if (editor) {
      await slackService.notifyEditorAssigned(job, editor);
    }
  } catch (err) {
    console.error('Assignment/notification error:', err.message);
  }

  res.json({ received: true, job_id: jobId, assigned_to: editor?.name || null });
});

module.exports = router;
