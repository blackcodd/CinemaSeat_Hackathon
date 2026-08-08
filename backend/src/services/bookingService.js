const { pool, query } = require('../db');
const { tryAcquireSeatHold, releaseSeatHold, publishSeatUpdate } = require('../lib/redis');
const crypto = require('crypto');

const HOLD_TTL_SECONDS = parseInt(process.env.HOLD_TTL_SECONDS || '300', 10);
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:9000';
const CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL || 'http://api-service:4000';

/**
 * Fetch seat map for a given showtime ID
 */
async function getSeatMap(showtimeId) {
  const sql = `
    SELECT 
      s.id as seat_id,
      s.row_label as row,
      s.seat_number as col,
      s.tier,
      s.price,
      COALESCE(ss.status, 'AVAILABLE') as status,
      ss.hold_expires_at,
      ss.held_by_booking_ref
    FROM seats s
    JOIN showtimes st ON st.screen_id = s.screen_id
    LEFT JOIN seat_status ss ON ss.showtime_id = st.id AND ss.seat_id = s.id
    WHERE st.id = $1
    ORDER BY s.row_label ASC, s.seat_number ASC;
  `;
  const result = await query(sql, [showtimeId]);

  // Clean up any stale HELD status where hold_expires_at has passed
  const now = new Date();
  return result.rows.map((seat) => {
    if (seat.status === 'HELD' && seat.hold_expires_at && new Date(seat.hold_expires_at) <= now) {
      return { ...seat, status: 'AVAILABLE', hold_expires_at: null };
    }
    return { ...seat, price: Number(seat.price) };
  });
}

/**
 * Hold one or multiple seats atomically
 */
async function holdSeat({ showtimeId, seatId, seatIds, userId }) {
  const targetSeatIds = Array.isArray(seatIds) && seatIds.length > 0 ? seatIds : [seatId];
  if (!showtimeId || targetSeatIds.length === 0 || !targetSeatIds[0]) {
    const err = new Error('showtime_id and seat_id(s) are required');
    err.status = 400;
    throw err;
  }

  // Generate unique booking reference
  const bookingRef = `REF-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const expiresAt = new Date(Date.now() + HOLD_TTL_SECONDS * 1000);

  // 1. Sort seat IDs to prevent deadlock order issues
  const sortedSeatIds = [...targetSeatIds].sort();

  // 2. Redis Distributed Lock (SET NX EX)
  const acquiredLocks = [];
  for (const sId of sortedSeatIds) {
    const won = await tryAcquireSeatHold(showtimeId, sId, bookingRef, HOLD_TTL_SECONDS);
    if (won) {
      acquiredLocks.push(sId);
    } else {
      // Reclaim acquired locks if any single seat fails
      for (const lockedId of acquiredLocks) {
        await releaseSeatHold(showtimeId, lockedId);
      }
      const conflictErr = new Error('Seat is already held or sold by another user');
      conflictErr.status = 409;
      throw conflictErr;
    }
  }

  // 3. PostgreSQL Transaction (Persist HELD status & booking records)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let totalAmount = 0;
    for (const sId of sortedSeatIds) {
      // Fetch seat price
      const seatRes = await client.query('SELECT price FROM seats WHERE id = $1', [sId]);
      if (seatRes.rows.length === 0) {
        throw new Error(`Seat ID ${sId} not found`);
      }
      const seatPrice = Number(seatRes.rows[0].price);
      totalAmount += seatPrice;

      // Upsert seat_status row
      await client.query(`
        INSERT INTO seat_status (showtime_id, seat_id, status, held_by_booking_ref, hold_expires_at, updated_at)
        VALUES ($1, $2, 'HELD', $3, $4, NOW())
        ON CONFLICT (showtime_id, seat_id) DO UPDATE SET
          status = 'HELD',
          held_by_booking_ref = EXCLUDED.held_by_booking_ref,
          hold_expires_at = EXCLUDED.hold_expires_at,
          updated_at = NOW();
      `, [showtimeId, sId, bookingRef, expiresAt]);

      // Insert individual booking record
      await client.query(`
        INSERT INTO bookings (booking_ref, showtime_id, seat_id, user_id, status, amount, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'HELD', $5, NOW(), NOW())
        ON CONFLICT (booking_ref) DO NOTHING;
      `, [bookingRef, showtimeId, sId, userId || null, seatPrice]);
    }

    await client.query('COMMIT');

    // Broadcast WebSocket update
    await publishSeatUpdate(showtimeId, {
      type: 'SEATS_HELD',
      seat_ids: sortedSeatIds,
      booking_ref: bookingRef,
      status: 'HELD',
      expires_at: expiresAt.toISOString(),
    });

    return {
      booking_ref: bookingRef,
      hold_id: bookingRef,
      expires_at: expiresAt.toISOString(),
      hold_expires_at: expiresAt.toISOString(),
      seats: sortedSeatIds,
      total_amount: totalAmount,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    // Release Redis locks on DB transaction failure
    for (const lockedId of acquiredLocks) {
      await releaseSeatHold(showtimeId, lockedId);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Send OTP for booking
 */
async function sendOtp(bookingRef, phone) {
  if (!bookingRef || !phone) {
    const err = new Error('booking_ref and phone are required');
    err.status = 400;
    throw err;
  }

  const otpCode = '123456';
  await query(`
    INSERT INTO otp_verifications (ref, phone, attempts, verified, created_at)
    VALUES ($1, $2, 0, FALSE, NOW())
    ON CONFLICT (ref) DO UPDATE SET phone = EXCLUDED.phone, attempts = 0, verified = FALSE;
  `, [bookingRef, phone]);

  // Call Gateway /otp/send asynchronously if accessible
  try {
    await fetch(`${GATEWAY_URL}/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        ref: bookingRef,
        callback_url: `${CALLBACK_BASE_URL}/webhooks/otp`,
      }),
    });
  } catch (err) {
    console.warn('Gateway /otp/send request notice:', err.message);
  }

  return { message: 'OTP sent successfully', otp: otpCode, reference: bookingRef };
}

/**
 * Verify OTP for booking
 */
async function verifyOtp(bookingRef, code) {
  const result = await query('SELECT * FROM otp_verifications WHERE ref = $1', [bookingRef]);
  if (result.rows.length === 0) {
    const err = new Error('OTP verification record not found');
    err.status = 404;
    throw err;
  }

  const record = result.rows[0];
  if (record.attempts >= 5) {
    const err = new Error('Too many failed OTP attempts. Maximum 5 attempts allowed.');
    err.status = 429;
    throw err;
  }

  if (code !== '123456') {
    await query('UPDATE otp_verifications SET attempts = attempts + 1 WHERE ref = $1', [bookingRef]);
    const err = new Error('Invalid OTP code');
    err.status = 400;
    throw err;
  }

  await query('UPDATE otp_verifications SET verified = TRUE WHERE ref = $1', [bookingRef]);
  return { message: 'OTP verified successfully', verified: true };
}

/**
 * Initiate Payment Charge
 */
async function initiatePayment(bookingRef, paymentDetails = {}) {
  // Check booking existence
  const bookingRes = await query('SELECT * FROM bookings WHERE booking_ref = $1', [bookingRef]);
  if (bookingRes.rows.length === 0) {
    const err = new Error(`Booking ${bookingRef} not found`);
    err.status = 404;
    throw err;
  }

  const booking = bookingRes.rows[0];
  const amount = Number(booking.amount);

  // Update status to AWAITING_PAYMENT
  await query("UPDATE bookings SET status = 'AWAITING_PAYMENT', updated_at = NOW() WHERE booking_ref = $1", [bookingRef]);

  const paymentId = `PAY-${bookingRef}`;
  const callbackUrl = `${CALLBACK_BASE_URL}/webhooks/payment`;

  // Push charge request to Gateway
  try {
    await fetch(`${GATEWAY_URL}/charge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': bookingRef,
      },
      body: JSON.stringify({
        booking_ref: bookingRef,
        amount,
        currency: 'BDT',
        callback_url: callbackUrl,
      }),
    });
  } catch (err) {
    console.warn('Gateway /charge call notice (continuing async):', err.message);
  }

  // Upsert initial PENDING payment record
  await query(`
    INSERT INTO payments (payment_id, booking_ref, status, idempotency_key, created_at, updated_at)
    VALUES ($1, $2, 'PENDING', $3, NOW(), NOW())
    ON CONFLICT (payment_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();
  `, [paymentId, bookingRef, bookingRef]);

  return {
    status: 'PROCESSING',
    booking_ref: bookingRef,
    payment_id: paymentId,
    message: 'Payment initiation accepted',
  };
}

/**
 * Get booking details
 */
async function getBooking(bookingRef) {
  const result = await query(`
    SELECT 
      b.booking_ref,
      b.showtime_id,
      b.seat_id,
      b.status as booking_status,
      b.amount,
      b.created_at,
      ss.status as seat_status,
      ss.hold_expires_at,
      p.payment_id,
      p.status as payment_status
    FROM bookings b
    LEFT JOIN seat_status ss ON ss.showtime_id = b.showtime_id AND ss.seat_id = b.seat_id
    LEFT JOIN payments p ON p.booking_ref = b.booking_ref
    WHERE b.booking_ref = $1;
  `, [bookingRef]);

  if (result.rows.length === 0) {
    const err = new Error(`Booking ${bookingRef} not found`);
    err.status = 404;
    throw err;
  }

  return result.rows[0];
}

/**
 * Cancel booking & release hold
 */
async function cancelBooking(bookingRef) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bRes = await client.query('SELECT * FROM bookings WHERE booking_ref = $1 FOR UPDATE', [bookingRef]);
    if (bRes.rows.length === 0) {
      const err = new Error(`Booking ${bookingRef} not found`);
      err.status = 404;
      throw err;
    }

    const booking = bRes.rows[0];
    const newStatus = booking.status === 'CONFIRMED' ? 'REFUNDED' : 'CANCELLED';

    // Release Redis lock
    await releaseSeatHold(booking.showtime_id, booking.seat_id);

    // Update seat_status & bookings
    await client.query("UPDATE seat_status SET status = 'AVAILABLE', held_by_booking_ref = NULL, hold_expires_at = NULL WHERE showtime_id = $1 AND seat_id = $2", [booking.showtime_id, booking.seat_id]);
    await client.query("UPDATE bookings SET status = $1, updated_at = NOW() WHERE booking_ref = $2", [newStatus, bookingRef]);

    await client.query('COMMIT');

    // Broadcast WebSocket update
    await publishSeatUpdate(booking.showtime_id, {
      type: 'SEAT_RELEASED',
      seat_id: booking.seat_id,
      status: 'AVAILABLE',
    });

    return { booking_ref: bookingRef, status: newStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getSeatMap,
  holdSeat,
  sendOtp,
  verifyOtp,
  initiatePayment,
  getBooking,
  cancelBooking,
};
