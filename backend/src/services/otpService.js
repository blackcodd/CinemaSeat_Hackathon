const http = require('http');
const crypto = require('crypto');
const { query } = require('../db');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:9000';
const CALLBACK_BASE = process.env.CALLBACK_BASE_URL || process.env.OTP_CALLBACK_URL || 'http://api-service:4000';
const OTP_CALLBACK_URL = `${CALLBACK_BASE.replace(/\/$/, '')}/webhooks/otp`;

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

function makeGatewayPost(urlStr, data, extraHeaders = {}) {
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

      req.setTimeout(5000, () => {
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

async function sendOtp(bookingRef, phone, headers = {}) {
  if (!bookingRef || !phone) {
    const err = new Error('booking_ref and phone are required');
    err.statusCode = 400;
    throw err;
  }

  // Check if booking exists
  const bookingRes = await query('SELECT id FROM bookings WHERE booking_ref = $1', [bookingRef]);
  if (bookingRes.rows.length === 0) {
    const err = new Error('Booking not found');
    err.statusCode = 404;
    throw err;
  }

  const isDeterministic = headers['x-mock-mode'] === 'deterministic';
  const otp = isDeterministic ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes TTL

  // Clear existing OTP attempts for this booking
  await query('DELETE FROM otp_verifications WHERE booking_ref = $1', [bookingRef]);

  await query(
    `INSERT INTO otp_verifications (booking_ref, phone, otp_hash, expires_at, attempts)
     VALUES ($1, $2, $3, $4, 0)`,
    [bookingRef, phone, otpHash, expiresAt.toISOString()]
  );

  // Send request to Mock Gateway /otp/send asynchronously
  const mockHeaders = {};
  if (headers['x-mock-mode']) mockHeaders['x-mock-mode'] = headers['x-mock-mode'];

  makeGatewayPost(
    `${GATEWAY_URL}/otp/send`,
    { phone, ref: bookingRef, callback_url: OTP_CALLBACK_URL },
    mockHeaders
  ).catch((err) => {
    console.warn(`Gateway OTP send warning: ${err.message}`);
  });

  return { status: 'sent', ref: bookingRef, otp };
}

async function verifyOtp(bookingRef, otp) {
  if (!bookingRef || !otp) {
    const err = new Error('booking_ref and otp are required');
    err.statusCode = 400;
    throw err;
  }

  // First try gateway verification if gateway is reachable
  try {
    const gwRes = await makeGatewayPost(`${GATEWAY_URL}/otp/verify`, {
      ref: bookingRef,
      code: String(otp),
    });

    if (gwRes.statusCode === 200 && gwRes.body && gwRes.body.verified) {
      await query(`UPDATE otp_verifications SET verified_at = NOW() WHERE booking_ref = $1`, [bookingRef]);
      return { verified: true };
    } else if (gwRes.statusCode === 400 || gwRes.statusCode === 429) {
      const err = new Error(gwRes.body?.error || (gwRes.statusCode === 429 ? 'Too many attempts' : 'Invalid OTP'));
      err.statusCode = gwRes.statusCode;
      throw err;
    }
  } catch (err) {
    if (err.statusCode) throw err;
    console.warn(`Gateway /otp/verify unreachable (${err.message}). Falling back to local hashed verification.`);
  }

  // Local fallback verification against stored hash
  const res = await query(
    `SELECT * FROM otp_verifications WHERE booking_ref = $1 ORDER BY id DESC LIMIT 1`,
    [bookingRef]
  );

  if (res.rows.length === 0) {
    const err = new Error('No OTP request found for this booking');
    err.statusCode = 404;
    throw err;
  }

  const record = res.rows[0];

  if (record.verified_at) {
    return { verified: true };
  }

  if (new Date(record.expires_at) < new Date()) {
    const err = new Error('OTP has expired');
    err.statusCode = 400;
    throw err;
  }

  if (record.attempts >= 5) {
    const err = new Error('Too many failed attempts');
    err.statusCode = 429;
    throw err;
  }

  const inputHash = hashOtp(otp);
  if (inputHash !== record.otp_hash) {
    await query(`UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1`, [record.id]);
    const err = new Error('Invalid OTP');
    err.statusCode = 400;
    throw err;
  }

  await query(`UPDATE otp_verifications SET verified_at = NOW() WHERE id = $1`, [record.id]);
  return { verified: true };
}

module.exports = {
  sendOtp,
  verifyOtp,
  hashOtp,
};
