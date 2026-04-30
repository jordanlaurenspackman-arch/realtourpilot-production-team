const { getDb } = require('../db/database');
const { postMessage } = require('./slack');

function buildMorningDigest() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  const stats = {
    new:       db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'new'`).get().c,
    assigned:  db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'assigned'`).get().c,
    qc:        db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'completed'`).get().c,
    delivered_today: db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'delivered' AND date(delivered_at) = ?`).get(today).c,
  };

  const qcJobs = db.prepare(`
    SELECT j.id, j.property_address, j.client_name, e.name as editor_name
    FROM jobs j
    LEFT JOIN editors e ON e.id = j.assigned_editor_id
    WHERE j.status = 'completed'
    ORDER BY j.completed_at
  `).all();

  const overdueJobs = db.prepare(`
    SELECT j.id, j.property_address, j.client_name, e.name as editor_name, j.created_at
    FROM jobs j
    LEFT JOIN editors e ON e.id = j.assigned_editor_id
    WHERE j.status = 'assigned'
      AND datetime(j.updated_at) < datetime('now', '-48 hours')
  `).all();

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `☀️ Morning Digest — ${dateStr}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Unassigned:*\n${stats.new}` },
        { type: 'mrkdwn', text: `*In Progress:*\n${stats.assigned}` },
        { type: 'mrkdwn', text: `*Pending QC:*\n${stats.qc}` },
        { type: 'mrkdwn', text: `*Delivered Yesterday:*\n${stats.delivered_today}` },
      ],
    },
  ];

  if (qcJobs.length) {
    const lines = qcJobs.map(j =>
      `• *#${j.id}* ${j.property_address || j.client_name || 'Untitled'} — ${j.editor_name || 'Unknown'}`
    );
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🟠 Needs QC Review (${qcJobs.length}):*\n${lines.join('\n')}` },
    });
  }

  if (overdueJobs.length) {
    const lines = overdueJobs.map(j =>
      `• *#${j.id}* ${j.property_address || j.client_name || 'Untitled'} — ${j.editor_name || 'Unknown'}`
    );
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🔴 Overdue (48h+, ${overdueJobs.length}):*\n${lines.join('\n')}` },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Open QC Dashboard' },
        url: `${appUrl}/dashboard`,
        style: 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Morning View' },
        url: `${appUrl}/morning`,
      },
    ],
  });

  return { text: `Morning Digest — ${dateStr}`, blocks };
}

async function sendMorningDigest() {
  const channel = process.env.SLACK_REPORTS_CHANNEL || '#daily-reports';
  const { text, blocks } = buildMorningDigest();
  await postMessage(channel, text, blocks);
}

function buildWeeklyReport() {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const delivered = db.prepare(`
    SELECT COUNT(*) as c FROM jobs
    WHERE status = 'delivered' AND delivered_at >= ?
  `).get(weekAgo).c;

  const created = db.prepare(`
    SELECT COUNT(*) as c FROM jobs WHERE created_at >= ?
  `).get(weekAgo).c;

  const avgTurnaround = db.prepare(`
    SELECT AVG(
      (julianday(completed_at) - julianday(created_at)) * 24
    ) as avg_hours
    FROM jobs
    WHERE completed_at IS NOT NULL AND created_at >= ?
  `).get(weekAgo).avg_hours;

  const byEditor = db.prepare(`
    SELECT e.name, COUNT(*) as delivered
    FROM jobs j
    JOIN editors e ON e.id = j.assigned_editor_id
    WHERE j.status = 'delivered' AND j.delivered_at >= ?
    GROUP BY e.id
    ORDER BY delivered DESC
  `).all(weekAgo);

  const serviceBreakdown = db.prepare(`
    SELECT service_type, COUNT(*) as cnt
    FROM jobs
    WHERE created_at >= ? AND service_type IS NOT NULL
    GROUP BY service_type
    ORDER BY cnt DESC
    LIMIT 8
  `).all(weekAgo);

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📊 Weekly Report — Week ending ${dateStr}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Jobs Created:*\n${created}` },
        { type: 'mrkdwn', text: `*Jobs Delivered:*\n${delivered}` },
        { type: 'mrkdwn', text: `*Avg Turnaround:*\n${avgTurnaround ? avgTurnaround.toFixed(1) + ' hrs' : 'N/A'}` },
      ],
    },
  ];

  if (byEditor.length) {
    const lines = byEditor.map(e => `• ${e.name}: ${e.delivered} delivered`);
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Editor Output:*\n${lines.join('\n')}` },
    });
  }

  if (serviceBreakdown.length) {
    const lines = serviceBreakdown.map(s => `• ${s.service_type}: ${s.cnt}`);
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Services This Week:*\n${lines.join('\n')}` },
    });
  }

  return { text: `Weekly Report — ${dateStr}`, blocks };
}

async function sendWeeklyReport() {
  const channel = process.env.SLACK_REPORTS_CHANNEL || '#daily-reports';
  const { text, blocks } = buildWeeklyReport();
  await postMessage(channel, text, blocks);
}

module.exports = { sendMorningDigest, sendWeeklyReport, buildMorningDigest, buildWeeklyReport };
