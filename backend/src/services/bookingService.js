const { getClient, pool } = require('../db');

/**
 * Core Hackathon Seat Hold Logic
 * Uses PostgreSQL transaction + SELECT FOR UPDATE to guarantee 0 oversell under concurrency.
 */
async function holdSeat(seatId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Lock seat with FOR UPDATE
    const seatRes = await client.query(
      `SELECT * FROM seats WHERE id = $1 FOR UPDATE`,
      [seatId]
    );

    if (seatRes.rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Seat not found');
      err.statusCode = 404;
      throw err;
    }

    const seat = seatRes.rows[0];
    const now = new Date();

    // 2. Status validation
    if (seat.status === 'CONFIRMED' || seat.status === 'PAID') {
      await client.query('ROLLBACK');
      const err = new Error('Seat is already confirmed/paid');
      err.statusCode = 409;
      throw err;
    }

    if (seat.status === 'HELD') {
      const holdExpiresAt = new Date(seat.hold_expires_at);
      if (holdExpiresAt > now) {
        await client.query('ROLLBACK');
        const err = new Error('Seat is currently held by another user');
        err.statusCode = 409;
        throw err;
      }
      // If hold_expires_at <= now, old hold is expired. We can reclaim it!
    }

    // 3. Calculate expiry using environment variable HOLD_TTL_SECONDS
    const ttlSeconds = parseInt(process.env.HOLD_TTL_SECONDS || '60', 10);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const bookingRef = `REF-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

    // 4. Update seat state
    await client.query(
      `UPDATE seats 
       SET status = 'HELD', 
           hold_expires_at = $1, 
           version = version + 1, 
           updated_at = NOW() 
       WHERE id = $2`,
      [expiresAt.toISOString(), seatId]
    );

    // 5. Create booking entry
    await client.query(
      `INSERT INTO bookings (seat_id, booking_ref, status) 
       VALUES ($1, $2, 'PENDING')`,
      [seatId, bookingRef]
    );

    await client.query('COMMIT');

    return {
      hold_id: bookingRef,
      expires_at: expiresAt.toISOString(),
      booking_ref: bookingRef,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Process Hold Expiry Worker
 * Finds HELD seats whose hold_expires_at <= NOW() and releases them to AVAILABLE.
 */
async function processHoldExpiry() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Find expired held seats
    const expiredRes = await client.query(
      `SELECT id FROM seats 
       WHERE status = 'HELD' AND hold_expires_at <= NOW() 
       FOR UPDATE`
    );

    for (const row of expiredRes.rows) {
      const seatId = row.id;

      // Revert seat to AVAILABLE
      await client.query(
        `UPDATE seats 
         SET status = 'AVAILABLE', 
             hold_expires_at = NULL, 
             version = version + 1, 
             updated_at = NOW() 
         WHERE id = $1 AND status = 'HELD'`,
        [seatId]
      );

      // Expire related pending bookings
      await client.query(
        `UPDATE bookings 
         SET status = 'EXPIRED', 
             updated_at = NOW() 
         WHERE seat_id = $1 AND status = 'PENDING'`,
        [seatId]
      );
    }

    await client.query('COMMIT');
    return expiredRes.rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in processHoldExpiry:', err);
    return 0;
  } finally {
    client.release();
  }
}

/**
 * Confirm Booking (For Person 2 Payment Integration)
 * Idempotent confirmation service.
 */
async function confirmBooking(bookingRef, paymentId, eventId, amount) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Deduplication check: check if eventId already processed
    if (eventId) {
      const existingPay = await client.query(
        `SELECT * FROM payments WHERE event_id = $1`,
        [eventId]
      );
      if (existingPay.rows.length > 0) {
        await client.query('COMMIT');
        return { success: true, duplicate: true, payment: existingPay.rows[0] };
      }
    }

    // Lock booking
    const bookingRes = await client.query(
      `SELECT * FROM bookings WHERE booking_ref = $1 FOR UPDATE`,
      [bookingRef]
    );

    if (bookingRes.rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Booking not found');
      err.statusCode = 404;
      throw err;
    }

    const booking = bookingRes.rows[0];

    // Lock seat
    await client.query(
      `SELECT * FROM seats WHERE id = $1 FOR UPDATE`,
      [booking.seat_id]
    );

    // Update seat status to CONFIRMED
    await client.query(
      `UPDATE seats 
       SET status = 'CONFIRMED', 
           hold_expires_at = NULL, 
           updated_at = NOW() 
       WHERE id = $1`,
      [booking.seat_id]
    );

    // Update booking status to CONFIRMED
    await client.query(
      `UPDATE bookings 
       SET status = 'CONFIRMED', 
           updated_at = NOW() 
       WHERE id = $1`,
      [booking.id]
    );

    // Record payment safely
    let paymentRes;
    if (paymentId) {
      paymentRes = await client.query(
        `INSERT INTO payments (booking_ref, payment_id, event_id, status, amount)
         VALUES ($1, $2, $3, 'SUCCEEDED', $4)
         ON CONFLICT (payment_id) DO UPDATE 
         SET status = 'SUCCEEDED', 
             event_id = COALESCE(EXCLUDED.event_id, payments.event_id), 
             amount = EXCLUDED.amount, 
             updated_at = NOW()
         RETURNING *`,
        [bookingRef, paymentId, eventId || null, amount || 0]
      );
    } else if (eventId) {
      paymentRes = await client.query(
        `INSERT INTO payments (booking_ref, payment_id, event_id, status, amount)
         VALUES ($1, $2, $3, 'SUCCEEDED', $4)
         ON CONFLICT (event_id) DO UPDATE 
         SET status = 'SUCCEEDED', 
             amount = EXCLUDED.amount, 
             updated_at = NOW()
         RETURNING *`,
        [bookingRef, `pay_${Date.now()}`, eventId, amount || 0]
      );
    } else {
      paymentRes = await client.query(
        `INSERT INTO payments (booking_ref, payment_id, event_id, status, amount)
         VALUES ($1, $2, $3, 'SUCCEEDED', $4)
         RETURNING *`,
        [bookingRef, `pay_${Date.now()}`, `evt_${Date.now()}`, amount || 0]
      );
    }

    await client.query('COMMIT');

    return { success: true, payment: paymentRes.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fail Booking (For Person 2 Payment Integration)
 * Releases held seat and marks booking failed.
 */
async function failBooking(bookingRef, paymentId, eventId, amount) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (eventId) {
      const existingPay = await client.query(
        `SELECT * FROM payments WHERE event_id = $1`,
        [eventId]
      );
      if (existingPay.rows.length > 0) {
        await client.query('COMMIT');
        return { success: true, duplicate: true, payment: existingPay.rows[0] };
      }
    }

    const bookingRes = await client.query(
      `SELECT * FROM bookings WHERE booking_ref = $1 FOR UPDATE`,
      [bookingRef]
    );

    if (bookingRes.rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Booking not found');
      err.statusCode = 404;
      throw err;
    }

    const booking = bookingRes.rows[0];

    // Release seat back to AVAILABLE
    await client.query(
      `UPDATE seats 
       SET status = 'AVAILABLE', 
           hold_expires_at = NULL, 
           version = version + 1, 
           updated_at = NOW() 
       WHERE id = $1 AND status != 'CONFIRMED'`,
      [booking.seat_id]
    );

    // Update booking status to FAILED
    await client.query(
      `UPDATE bookings 
       SET status = 'FAILED', 
           updated_at = NOW() 
       WHERE id = $1`,
      [booking.id]
    );

    // Record payment failure safely
    let paymentRes;
    if (paymentId) {
      paymentRes = await client.query(
        `INSERT INTO payments (booking_ref, payment_id, event_id, status, amount)
         VALUES ($1, $2, $3, 'FAILED', $4)
         ON CONFLICT (payment_id) DO UPDATE 
         SET status = 'FAILED', 
             event_id = COALESCE(EXCLUDED.event_id, payments.event_id), 
             amount = EXCLUDED.amount, 
             updated_at = NOW()
         RETURNING *`,
        [bookingRef, paymentId, eventId || null, amount || 0]
      );
    } else if (eventId) {
      paymentRes = await client.query(
        `INSERT INTO payments (booking_ref, payment_id, event_id, status, amount)
         VALUES ($1, $2, $3, 'FAILED', $4)
         ON CONFLICT (event_id) DO UPDATE 
         SET status = 'FAILED', 
             amount = EXCLUDED.amount, 
             updated_at = NOW()
         RETURNING *`,
        [bookingRef, `pay_fail_${Date.now()}`, eventId, amount || 0]
      );
    } else {
      paymentRes = await client.query(
        `INSERT INTO payments (booking_ref, payment_id, event_id, status, amount)
         VALUES ($1, $2, $3, 'FAILED', $4)
         RETURNING *`,
        [bookingRef, `pay_fail_${Date.now()}`, `evt_fail_${Date.now()}`, amount || 0]
      );
    }

    await client.query('COMMIT');
    return { success: true, payment: paymentRes.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Release Held Seat Helper
 */
async function releaseHeldSeat(seatId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE seats 
       SET status = 'AVAILABLE', 
           hold_expires_at = NULL, 
           version = version + 1, 
           updated_at = NOW() 
       WHERE id = $1 AND status = 'HELD'`,
      [seatId]
    );
    await client.query(
      `UPDATE bookings 
       SET status = 'CANCELLED', 
           updated_at = NOW() 
       WHERE seat_id = $1 AND status = 'PENDING'`,
      [seatId]
    );
    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  holdSeat,
  processHoldExpiry,
  confirmBooking,
  failBooking,
  releaseHeldSeat,
};
