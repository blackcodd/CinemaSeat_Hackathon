const http = require('http');
const crypto = require('crypto');
const { query } = require('../db');
const { confirmBooking, failBooking } = require('./bookingService');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:9000';
const WEBHOOK_CALLBACK_URL = process.env.WEBHOOK_CALLBACK_URL || 'http://backend:4000/webhooks/payment';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'secret';

// In-memory idempotency cache for Idempotency-Key header support
const idempotencyStore = new Map();

function verifyWebhookSignature(req) {
  const signature = req.headers['x-signature'] || req.headers['x-hmac-signature'];
  if (!signature) {
    // If no signature header sent by gateway, allow request
    return true;
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hmac));
}

function makeGatewayRequest(urlStr, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const postData = JSON.stringify(data);

      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...extraHeaders,
      };

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.pathname,
        method: 'POST',
        headers,
      };

      const req = http.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(responseData);
          } catch (e) {
            json = { raw: responseData };
          }
          resolve({ statusCode: res.statusCode, body: json });
        });
      });

      // 30 second timeout handling
      req.setTimeout(30000, () => {
        req.destroy(new Error('Gateway request timeout'));
      });

      req.on('error', (err) => reject(err));
      req.write(postData);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function processPayment({ booking_ref, amount, phone, idempotency_key, headers = {} }) {
  if (!booking_ref) {
    const err = new Error('booking_ref is required');
    err.statusCode = 400;
    throw err;
  }

  // Idempotency Key check
  if (idempotency_key && idempotencyStore.has(idempotency_key)) {
    return idempotencyStore.get(idempotency_key);
  }

  // Validate booking
  const bookingRes = await query('SELECT * FROM bookings WHERE booking_ref = $1', [booking_ref]);
  if (bookingRes.rows.length === 0) {
    const err = new Error('Booking not found');
    err.statusCode = 404;
    throw err;
  }

  const booking = bookingRes.rows[0];

  if (booking.status === 'EXPIRED' || booking.status === 'CANCELLED' || booking.status === 'FAILED') {
    const err = new Error(`Booking is no longer valid (status: ${booking.status})`);
    err.statusCode = 400;
    throw err;
  }

  if (booking.status === 'CONFIRMED') {
    const existingPayment = await query('SELECT * FROM payments WHERE booking_ref = $1', [booking_ref]);
    const response = {
      payment_id: existingPayment.rows[0]?.payment_id || `pay_confirmed_${booking_ref}`,
      status: 'SUCCEEDED',
      booking_ref,
    };
    if (idempotency_key) idempotencyStore.set(idempotency_key, response);
    return response;
  }

  const paymentId = `pay_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // Record initial PENDING payment in DB
  await query(
    `INSERT INTO payments (booking_ref, payment_id, status, amount)
     VALUES ($1, $2, 'PENDING', $3)
     ON CONFLICT (payment_id) DO NOTHING`,
    [booking_ref, paymentId, amount || 0]
  );

  // Extract Mock Control Headers if passed
  const mockHeaders = {};
  if (headers['x-mock-mode']) mockHeaders['x-mock-mode'] = headers['x-mock-mode'];
  if (headers['x-mock-force']) mockHeaders['x-mock-force'] = headers['x-mock-force'];

  const gatewayPayload = {
    booking_ref,
    payment_id: paymentId,
    amount: amount || 0,
    phone,
    callback_url: WEBHOOK_CALLBACK_URL,
  };

  let gatewayResult = null;
  try {
    const chargeUrl = `${GATEWAY_URL}/charge`;
    gatewayResult = await makeGatewayRequest(chargeUrl, gatewayPayload, mockHeaders);
  } catch (err) {
    console.warn(`Gateway request warning (${err.message}). Defaulting to pending state for webhook handling.`);
  }

  // Check DB state in case early webhook callback arrived during /charge call (race condition handling)
  const freshBooking = await query('SELECT status FROM bookings WHERE booking_ref = $1', [booking_ref]);
  if (freshBooking.rows[0]?.status === 'CONFIRMED') {
    const response = {
      payment_id: paymentId,
      status: 'SUCCEEDED',
      booking_ref,
    };
    if (idempotency_key) idempotencyStore.set(idempotency_key, response);
    return response;
  }

  let finalStatus = 'PENDING';
  if (gatewayResult && gatewayResult.body) {
    if (gatewayResult.body.status === 'SUCCEEDED' || gatewayResult.body.status === 'SUCCESS') {
      finalStatus = 'SUCCEEDED';
      await confirmBooking(booking_ref, paymentId, gatewayResult.body.event_id, amount);
    } else if (gatewayResult.body.status === 'FAILED' || gatewayResult.body.status === 'FAILURE') {
      finalStatus = 'FAILED';
      await failBooking(booking_ref, paymentId, gatewayResult.body.event_id, amount);
    }
  }

  const response = {
    payment_id: paymentId,
    status: finalStatus,
    booking_ref,
  };

  if (idempotency_key) idempotencyStore.set(idempotency_key, response);
  return response;
}

async function handlePaymentWebhook(payload) {
  const bookingRef = payload.booking_ref || payload.bookingRef || payload.reference;
  const paymentId = payload.payment_id || payload.paymentId || payload.id;
  const eventId = payload.event_id || payload.eventId;
  const status = (payload.status || payload.event_type || 'SUCCEEDED').toUpperCase();
  const amount = payload.amount || 0;

  if (!bookingRef) {
    const err = new Error('booking_ref is required in webhook payload');
    err.statusCode = 400;
    throw err;
  }

  if (status === 'SUCCEEDED' || status === 'SUCCESS' || status === 'PAYMENT_SUCCESS') {
    return await confirmBooking(bookingRef, paymentId, eventId, amount);
  } else {
    return await failBooking(bookingRef, paymentId, eventId, amount);
  }
}

module.exports = {
  processPayment,
  handlePaymentWebhook,
  verifyWebhookSignature,
};
