const { App, ExpressReceiver } = require('@slack/bolt');

let slackApp;
let receiver;

function initSlack() {
  receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET || 'dev-secret',
    endpoints: '/slack/events',
  });

  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn('[slack] SLACK_BOT_TOKEN not set — Slack notifications disabled');
    return { slackApp: null, receiver };
  }

  try {
    slackApp = new App({ token: process.env.SLACK_BOT_TOKEN, receiver });
  } catch (err) {
    console.error('[slack] Failed to initialize Slack app:', err.message);
  }

  return { slackApp, receiver };
}

function getApp() {
  return slackApp || null;
}

async function notifyEditorAssigned(job, editor) {
  const app = getApp();
  if (!app) return;
  const channel = editor.slack_user_id
    ? `@${editor.slack_user_id}`
    : process.env.SLACK_JOBS_CHANNEL || '#jobs';

  await app.client.chat.postMessage({
    channel,
    text: `You've been assigned a new job!`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📷 New Job Assigned' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Job ID:*\n#${job.id}` },
          { type: 'mrkdwn', text: `*Client:*\n${job.client_name || 'N/A'}` },
          { type: 'mrkdwn', text: `*Address:*\n${job.property_address || 'N/A'}` },
          { type: 'mrkdwn', text: `*Service:*\n${job.service_type || 'N/A'}` },
          { type: 'mrkdwn', text: `*Shoot Date:*\n${job.scheduled_at ? new Date(job.scheduled_at).toLocaleDateString() : 'TBD'}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `When finished, mark this job done with:\n\`/job-done ${job.id}\``,
        },
      },
    ],
  });
}

async function notifyQcReady(job, editor) {
  const app = getApp();
  if (!app) return;
  const channel = process.env.SLACK_QC_CHANNEL || '#qc-review';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  await app.client.chat.postMessage({
    channel,
    text: `Job #${job.id} is ready for QC review`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '✅ Job Ready for QC' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Job ID:*\n#${job.id}` },
          { type: 'mrkdwn', text: `*Editor:*\n${editor?.name || 'Unknown'}` },
          { type: 'mrkdwn', text: `*Client:*\n${job.client_name || 'N/A'}` },
          { type: 'mrkdwn', text: `*Address:*\n${job.property_address || 'N/A'}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Review in Dashboard' },
            url: `${appUrl}/dashboard`,
            style: 'primary',
          },
        ],
      },
    ],
  });
}

async function notifyDelivered(job) {
  const app = getApp();
  if (!app) return;
  const channel = process.env.SLACK_QC_CHANNEL || '#qc-review';

  await app.client.chat.postMessage({
    channel,
    text: `Job #${job.id} has been delivered to the client.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚀 *Job #${job.id} delivered* — ${job.property_address || job.client_name || ''} has been sent to the client via Aryeo.`,
        },
      },
    ],
  });
}

async function notifyRejected(job, editor, reason) {
  const app = getApp();
  if (!app) return;
  const channel = editor?.slack_user_id ? `@${editor.slack_user_id}` : process.env.SLACK_JOBS_CHANNEL || '#jobs';

  await app.client.chat.postMessage({
    channel,
    text: `Job #${job.id} was sent back for revisions`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔁 Revision Requested' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Job ID:*\n#${job.id}` },
          { type: 'mrkdwn', text: `*Address:*\n${job.property_address || 'N/A'}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Reason:*\n${reason || 'No reason provided'}` },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `When fixed, mark it done again with:\n\`/job-done ${job.id}\``,
        },
      },
    ],
  });
}

async function postMessage(channel, text, blocks) {
  const app = getApp();
  if (!app) return;
  return app.client.chat.postMessage({ channel, text, blocks });
}

module.exports = {
  initSlack,
  getApp,
  notifyEditorAssigned,
  notifyQcReady,
  notifyDelivered,
  notifyRejected,
  postMessage,
};
