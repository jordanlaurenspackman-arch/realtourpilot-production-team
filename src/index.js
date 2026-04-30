require('dotenv').config();
// Suppress node:sqlite experimental warning — it's stable enough for production use
process.removeAllListeners('warning');
const express = require('express');
const path = require('path');
const { getDb } = require('./db/database');
const { initSlack } = require('./services/slack');
const { startScheduler } = require('./services/scheduler');
const webhooksRouter = require('./routes/webhooks');
const slackCommandsRouter = require('./routes/slackCommands');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize DB (runs migrations)
getDb();

// Initialize Slack — receiver exposes /slack/events on the same Express app
const { receiver } = initSlack();
app.use(receiver.router);

// Body parsers (order matters: raw must come before json for webhook route)
app.use('/webhooks', webhooksRouter); // uses its own express.raw() internally
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Slack slash commands
app.use('/slack/commands', slackCommandsRouter);

// Internal API
app.use('/api', apiRouter);

// Reports API (on-demand trigger for manual testing)
app.post('/api/reports/morning', async (req, res) => {
  const { sendMorningDigest } = require('./services/reports');
  try { await sendMorningDigest(); res.json({ sent: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reports/weekly', async (req, res) => {
  const { sendWeeklyReport } = require('./services/reports');
  try { await sendWeeklyReport(); res.json({ sent: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Dashboard pages
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/morning', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'morning.html'));
});

app.get('/', (req, res) => res.redirect('/dashboard'));

// Start scheduler for automated daily/weekly reports
startScheduler();

app.listen(PORT, () => {
  console.log(`Realtour Pilot running on port ${PORT}`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard`);
  console.log(`  Morning:    http://localhost:${PORT}/morning`);
  console.log(`  Webhooks:   POST http://localhost:${PORT}/webhooks/aryeo`);
});
