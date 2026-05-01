const { WebClient } = require('@slack/web-api');

let client = null;

function initSlack() {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn('[slack] SLACK_BOT_TOKEN not set — Slack notifications disabled');
    return;
  }
  client = new WebClient(process.env.SLACK_BOT_TOKEN);
  console.log('[slack] Slack client initialized');
}

function getClient() {
  return client;
}

async function send(channel, text, blocks) {
  if (!client) return;
  try {
    await client.chat.postMessage({ channel, text, blocks });
  } catch (err) {
    console.error('[slack] Failed to send message:', err.message);
  }
}

async function notifyEditorAssigned(job, editor, dropboxUrl) {
  const channel = editor.slack_user_id
    ? editor.slack_user_id
    : process.env.SLACK_JOBS_CHANNEL || '#jobs';

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📷 New Job Assigned' } },
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
  ];

  if (dropboxUrl) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `📁 *Dropbox Folder:*\n<${dropboxUrl}|Open shoot folder>` },
    });
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `When finished: \`/job-done ${job.id}\`` },
  });

  // Also post to the production team channel to trigger workflow
  const jobsChannel = process.env.SLACK_JOBS_CHANNEL || '#production-team';
  await send(jobsChannel, `New job #${job.id} assigned to ${editor.name} — ${job.property_address || job.client_name || ''}`, blocks);

  // DM the editor directly too
  if (editor.slack_user_id) {
    await send(editor.slack_user_id, `You've been assigned job #${job.id}`, blocks);
  }
}

async function notifyQcReady(job, editor) {
  const channel = process.env.SLACK_QC_CHANNEL || '#qc-review';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  await send(channel, `Job #${job.id} is ready for QC review`, [
    { type: 'header', text: { type: 'plain_text', text: '✅ Job Ready for QC' } },
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
  ]);
}

async function notifyDelivered(job) {
  const channel = process.env.SLACK_QC_CHANNEL || '#qc-review';
  await send(channel, `Job #${job.id} delivered`, [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🚀 *Job #${job.id} delivered* — ${job.property_address || job.client_name || ''} sent to client via Aryeo.`,
      },
    },
  ]);
}

async function notifyRejected(job, editor, reason) {
  const channel = editor?.slack_user_id
    ? editor.slack_user_id
    : process.env.SLACK_JOBS_CHANNEL || '#jobs';

  await send(channel, `Job #${job.id} sent back for revisions`, [
    { type: 'header', text: { type: 'plain_text', text: '🔁 Revision Requested' } },
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
      text: { type: 'mrkdwn', text: `When fixed: \`/job-done ${job.id}\`` },
    },
  ]);
}

async function postMessage(channel, text, blocks) {
  await send(channel, text, blocks);
}

module.exports = {
  initSlack,
  getClient,
  send,
  notifyEditorAssigned,
  notifyQcReady,
  notifyDelivered,
  notifyRejected,
  postMessage,
};
