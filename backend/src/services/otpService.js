const crypto = require('crypto');
const { query } = require('../db');

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

async function sendOtp(bookingRef, phone) {
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

  // Generate 6-digit numeric OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes TTL

  // Clear existing OTP attempts for this booking
  await query('DELETE FROM otp_verifications WHERE booking_ref = $1', [bookingRef]);

  await query(
    `INSERT INTO otp_verifications (booking_ref, phone, otp_hash, expires_at, attempts)
     VALUES ($1, $2, $3, $4, 0)`,
    [bookingRef, phone, otpHash, expiresAt.toISOString()]
  );

  return { status: 'sent', otp };
}

async function verifyOtp(bookingRef, otp) {
  if (!bookingRef || !otp) {
    const err = new Error('booking_ref and otp are required');
    err.statusCode = 400;
    throw err;
  }

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

  if (record.attempts >= 3) {
    const err = new Error('Too many failed attempts');
    err.statusCode = 400;
    throw err;
  }

  const inputHash = hashOtp(otp);
  if (inputHash !== record.otp_hash) {
    // Increment attempts
    await query(
      `UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1`,
      [record.id]
    );
    const err = new Error('Invalid OTP');
    err.statusCode = 400;
    throw err;
  }

  // Verification succeeded
  await query(
    `UPDATE otp_verifications SET verified_at = NOW() WHERE id = $1`,
    [record.id]
  );

  return { verified: true };
}

module.exports = {
  sendOtp,
  verifyOtp,
  hashOtp,
};
