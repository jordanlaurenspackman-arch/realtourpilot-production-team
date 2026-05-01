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
function str(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function parseOrderPayload(payload) {
  const order = payload.data || payload;
  return {
    aryeo_order_id:   str(order.id || order.order_id),
    aryeo_listing_id: str(order.listing?.id),
    client_name:      str(order.customer?.display_name || order.customer_name),
    client_email:     str(order.customer?.email || order.customer_email),
    service_type:     str((order.products || []).map(p => p.title).join(', ') || order.title),
    property_address: str(order.listing?.address?.deliverable_address || order.address),
    scheduled_at:     str(order.appointment_at || order.scheduled_at),
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

async function listOrders(page = 1) {
  const apiKey = process.env.ARYEO_API_KEY;
  if (!apiKey) throw new Error('ARYEO_API_KEY is not configured');

  const response = await axios.get(`${BASE_URL}/orders`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    params: { page, per_page: 50, sort: '-created_at' },
  });
  return response.data;
}

module.exports = { verifyWebhookSignature, parseOrderPayload, triggerDelivery, getOrder, listOrders };
