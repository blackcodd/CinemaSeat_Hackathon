const { pool } = require('./db');
const { dequeueWebhookEvent, releaseSeatHold, publishSeatUpdate } = require('./lib/redis');

console.log('[Worker Service] Started listening on Redis Queue: webhook:events...');

async function startWorker() {
  while (true) {
    try {
      // Blocking pop from Redis queue with 5-second timeout
      const eventData = await dequeueWebhookEvent(5);
      if (!eventData) continue;

      console.log(`[Worker Service] Processing webhook event ${eventData.event_id} for booking ${eventData.booking_ref}...`);
      await processPaymentStateTransition(eventData);
    } catch (err) {
      console.error('[Worker Service] Error processing queue message:', err);
      // Brief pause on error to avoid rapid spin loops
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Execute atomic PostgreSQL transaction for payment completion/failure
 */
async function processPaymentStateTransition(eventData) {
  const { event_id, payment_id, booking_ref, status, raw_payload } = eventData;
  const isSuccess = status === 'SUCCESS' || status === 'CONFIRMED' || status === 'COMPLETED';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch target booking record
    const bRes = await client.query('SELECT * FROM bookings WHERE booking_ref = $1 FOR UPDATE', [booking_ref]);
    if (bRes.rows.length === 0) {
      console.warn(`[Worker Service] Booking ${booking_ref} not found for event ${event_id}`);
      await client.query('COMMIT');
      return;
    }

    const booking = bRes.rows[0];
    const { showtime_id, seat_id } = booking;

    if (isSuccess) {
      // Confirm booking & seat status
      await client.query("UPDATE bookings SET status = 'CONFIRMED', updated_at = NOW() WHERE booking_ref = $1", [booking_ref]);
      await client.query("UPDATE seat_status SET status = 'CONFIRMED', updated_at = NOW() WHERE showtime_id = $1 AND seat_id = $2", [showtime_id, seat_id]);
      await client.query(`
        INSERT INTO payments (payment_id, booking_ref, status, raw_last_callback, created_at, updated_at)
        VALUES ($1, $2, 'CONFIRMED', $3, NOW(), NOW())
        ON CONFLICT (payment_id) DO UPDATE SET status = 'CONFIRMED', raw_last_callback = EXCLUDED.raw_last_callback, updated_at = NOW();
      `, [payment_id || `PAY-${booking_ref}`, booking_ref, raw_payload || eventData]);

      await client.query('COMMIT');

      // Publish realtime WebSocket update
      await publishSeatUpdate(showtime_id, {
        type: 'SEAT_CONFIRMED',
        booking_ref,
        seat_id,
        status: 'CONFIRMED',
      });
      console.log(`[Worker Service] Booking ${booking_ref} successfully CONFIRMED.`);

    } else {
      // Mark booking as FAILED and release seat
      await client.query("UPDATE bookings SET status = 'FAILED', updated_at = NOW() WHERE booking_ref = $1", [booking_ref]);
      await client.query("UPDATE seat_status SET status = 'AVAILABLE', held_by_booking_ref = NULL, hold_expires_at = NULL, updated_at = NOW() WHERE showtime_id = $1 AND seat_id = $2", [showtime_id, seat_id]);
      await client.query(`
        INSERT INTO payments (payment_id, booking_ref, status, raw_last_callback, created_at, updated_at)
        VALUES ($1, $2, 'FAILED', $3, NOW(), NOW())
        ON CONFLICT (payment_id) DO UPDATE SET status = 'FAILED', raw_last_callback = EXCLUDED.raw_last_callback, updated_at = NOW();
      `, [payment_id || `PAY-${booking_ref}`, booking_ref, raw_payload || eventData]);

      await client.query('COMMIT');

      // Release Redis distributed lock
      await releaseSeatHold(showtime_id, seat_id);

      // Publish realtime WebSocket update
      await publishSeatUpdate(showtime_id, {
        type: 'SEAT_RELEASED',
        booking_ref,
        seat_id,
        status: 'AVAILABLE',
      });
      console.log(`[Worker Service] Booking ${booking_ref} marked FAILED. Seat released.`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[Worker Service] Transaction failed for booking ${booking_ref}:`, err);
    throw err;
  } finally {
    client.release();
  }
}

// Start worker process
startWorker();
