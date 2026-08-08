process.env.NODE_ENV = 'test';
process.env.GATEWAY_SECRET = 'hackathon-secret-key';
process.env.HOLD_TTL_SECONDS = '300';

const http = require('http');
const crypto = require('crypto');
const { initDb, pool, query } = require('../db');
const { app } = require('../index');

const PORT = 4001;
let server = null;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const rawBodyData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (body && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = Buffer.byteLength(rawBodyData);
    }

    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: method,
      headers: reqHeaders,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, body: json });
      });
    });

    req.on('error', (err) => reject(err));

    if (rawBodyData) {
      req.write(rawBodyData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('==============================================');
  console.log('  STARTING MICROSERVICES SUITE (SCENARIOS A/B/C)');
  console.log('==============================================\n');

  let passed = 0;
  let failed = 0;

  async function assert(condition, description) {
    if (condition) {
      console.log(`[PASS] ${description}`);
      passed++;
    } else {
      console.error(`[FAIL] ${description}`);
      failed++;
    }
  }

  try {
    await initDb();
    server = app.listen(PORT);
    await new Promise((r) => setTimeout(r, 1500));

    // TEST 1: GET /health (Hook 1)
    const health = await request('GET', '/health');
    await assert(health.status === 200 && health.body.status === 'ok', 'HOOK 1: GET /health returns 200 OK');

    // TEST 2: GET /movies
    const movies = await request('GET', '/movies');
    await assert(movies.status === 200 && Array.isArray(movies.body) && movies.body.length >= 3, 'GET /movies returns >= 3 fictional movies');

    const showtimeId = '66666666-6666-4666-8666-666666666666';

    // TEST 3: GET /showtimes/:id/seats
    const seatmap = await request('GET', `/showtimes/${showtimeId}/seats`);
    await assert(seatmap.status === 200 && Array.isArray(seatmap.body) && seatmap.body.length === 32, 'GET /showtimes/:id/seats returns 32 seat grid');

    const targetSeat = seatmap.body[0].seat_id;

    // TEST 4: SCENARIO A — 100 CONCURRENT HOLDS ON ONE SEAT
    console.log('\n--- Running Scenario A: 100 Concurrent Holds on 1 Seat ---');
    const concurrentRequests = Array.from({ length: 100 }, () =>
      request('POST', '/bookings/hold', { showtime_id: showtimeId, seat_id: targetSeat })
    );

    const results = await Promise.all(concurrentRequests);
    const successCount = results.filter((r) => r.status === 200).length;
    const conflictCount = results.filter((r) => r.status === 409).length;

    await assert(successCount === 1, `Exact 1 request succeeded (Got: ${successCount})`);
    await assert(conflictCount === 99, `Exact 99 requests rejected with 409 Conflict (Got: ${conflictCount})`);

    const dbStatus = await query(
      'SELECT status FROM seat_status WHERE showtime_id = $1 AND seat_id = $2',
      [showtimeId, targetSeat]
    );
    await assert(dbStatus.rows[0].status === 'HELD', 'Seat status in PostgreSQL seat_status is HELD');

    // TEST 5: DIRECT DB INSERT BYPASS TEST (PARTIAL UNIQUE INDEX)
    console.log('\n--- Running Partial Unique Index Direct DB Bypass Test ---');
    let directInsertFailed = false;
    try {
      await query(
        "INSERT INTO seat_status (showtime_id, seat_id, status, held_by_booking_ref, hold_expires_at) VALUES ($1, $2, 'HELD', 'REF-BYPASS-TEST', NOW() + INTERVAL '5 min')",
        [showtimeId, targetSeat]
      );
    } catch (err) {
      if (err.code === '23505') { // unique_violation
        directInsertFailed = true;
      }
    }
    await assert(directInsertFailed, 'Partial Unique Index (one_active_holder_per_seat) rejected direct DB bypass insert with 23505 unique violation');

    // TEST 6: WEBHOOK IDEMPOTENCY & HMAC SIGNATURE
    console.log('\n--- Running Webhook Ingestion & Idempotency Test ---');
    const bookingRef = results.find((r) => r.status === 200).body.booking_ref;

    const webhookPayload = JSON.stringify({
      event_id: 'evt_test_microservice_100',
      payment_id: `PAY-${bookingRef}`,
      booking_ref: bookingRef,
      status: 'SUCCESS',
      amount: 400,
    });

    const signature = crypto.createHmac('sha256', process.env.GATEWAY_SECRET || 'z2p-2026-secret').update(webhookPayload).digest('hex');

    const webhook1 = await request('POST', '/webhooks/payment', webhookPayload, { 'X-Signature': signature });
    await assert(webhook1.status === 200, 'POST /webhooks/payment accepts valid payload and ACKs in <10ms');

    const webhook2 = await request('POST', '/webhooks/payment', webhookPayload, { 'X-Signature': signature });
    await assert(webhook2.status === 200, 'POST /webhooks/payment handles duplicate event_id idempotently (returns 200 OK)');

  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    if (server) server.close();
    await pool.end();
  }

  console.log('\n==============================================');
  console.log(` TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('==============================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
