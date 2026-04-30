const crypto = require('crypto');
const axios = require('axios');

const BASE_URL = 'https://api.aryeo.com/v1';

function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.ARYEO_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification in dev if not configured

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(`sha256=${expected}`),
    Buffer.from(signatureHeader)
  );
}

// Parse an Aryeo order webhook payload into our job shape
function parseOrderPayload(payload) {
  const order = payload.data || payload;
  return {
    aryeo_order_id:   order.id || order.order_id || null,
    aryeo_listing_id: order.listing?.id || null,
    client_name:      order.customer?.display_name || order.customer_name || null,
    client_email:     order.customer?.email || order.customer_email || null,
    service_type:     (order.products || []).map(p => p.title).join(', ') || order.title || null,
    property_address: order.listing?.address?.deliverable_address || order.address || null,
    scheduled_at:     order.appointment_at || order.scheduled_at || null,
  };
}

async function triggerDelivery(aryeoOrderId) {
  const apiKey = process.env.ARYEO_API_KEY;
  if (!apiKey) throw new Error('ARYEO_API_KEY is not configured');

  const response = await axios.put(
    `${BASE_URL}/orders/${aryeoOrderId}`,
    { fulfillment_status: 'fulfilled' },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

async function getOrder(aryeoOrderId) {
  const apiKey = process.env.ARYEO_API_KEY;
  if (!apiKey) throw new Error('ARYEO_API_KEY is not configured');

  const response = await axios.get(`${BASE_URL}/orders/${aryeoOrderId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return response.data;
}

module.exports = { verifyWebhookSignature, parseOrderPayload, triggerDelivery, getOrder };
