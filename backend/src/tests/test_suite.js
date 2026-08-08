process.env.NODE_ENV = 'test';

const http = require('http');
const { initDb, pool, query } = require('../db');
const { holdSeat, processHoldExpiry, confirmBooking, failBooking } = require('../services/bookingService');
const { app } = require('../index');

const PORT = 4001; // Separate test port
let server = null;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
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

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('==============================================');
  console.log('   STARTING PERSON 1 TEST SUITE');
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
    // 1. Fresh DB reset for test
    await query('TRUNCATE movies, theatres, showtimes, seats, bookings, payments, otp_verifications RESTART IDENTITY CASCADE;');
    await initDb();

    server = app.listen(PORT);
    console.log(`Test server running on port ${PORT}\n`);

    // TEST 1: GET /health
    const health = await request('GET', '/health');
    await assert(health.status === 200 && health.body.status === 'ok', 'HOOK 1: GET /health returns 200 OK');

    // TEST 2: GET /movies
    const movies = await request('GET', '/movies');
    await assert(movies.status === 200 && Array.isArray(movies.body) && movies.body.length >= 3, 'GET /movies returns >= 3 movies');

    // TEST 3: GET /showtimes
    const showtimes = await request('GET', '/showtimes?movie_id=1');
    await assert(showtimes.status === 200 && Array.isArray(showtimes.body) && showtimes.body.length >= 1, 'GET /showtimes?movie_id=1 returns showtimes');

    // TEST 4: GET /seatmap/:showtime_id
    const seatmap = await request('GET', '/seatmap/1');
    await assert(seatmap.status === 200 && Array.isArray(seatmap.body) && seatmap.body.length === 32, 'GET /seatmap/1 returns 32 seats');

    const s1 = seatmap.body[0].seat_id;
    const s2 = seatmap.body[1].seat_id;
    const s4 = seatmap.body[3].seat_id;
    const s5 = seatmap.body[4].seat_id;
    const s10 = seatmap.body[9].seat_id;

    // TEST 5: Normal Seat Hold (POST /seats/:seat_id/hold)
    const hold1 = await request('POST', `/seats/${s1}/hold`);
    await assert(
      hold1.status === 200 && hold1.body.hold_id && hold1.body.booking_ref && hold1.body.expires_at,
      `POST /seats/${s1}/hold successfully holds an AVAILABLE seat`
    );

    // TEST 6: Already Held Seat (Duplicate hold attempt)
    const hold1Duplicate = await request('POST', `/seats/${s1}/hold`);
    await assert(
      hold1Duplicate.status === 409,
      `POST /seats/${s1}/hold returns 409 Conflict when attempting to hold an already-held seat`
    );

    // TEST 7: Hold Expiry Reclaim
    process.env.HOLD_TTL_SECONDS = '1'; // Short TTL for test
    const hold2 = await request('POST', `/seats/${s2}/hold`);
    await assert(hold2.status === 200, `Seat ${s2} held with 1s TTL`);
    
    await new Promise((r) => setTimeout(r, 2000)); // Wait for TTL to expire
    const expiredCount = await processHoldExpiry();
    await assert(expiredCount >= 1, 'Expiry worker reclaimed expired seat hold');

    const seatmapAfterExpiry = await request('GET', '/seatmap/1');
    const seat2 = seatmapAfterExpiry.body.find((s) => s.seat_id === s2);
    await assert(seat2 && seat2.status === 'AVAILABLE', `Seat ${s2} status reverted to AVAILABLE after expiry`);

    // Reset TTL for remaining tests
    process.env.HOLD_TTL_SECONDS = '60';

    // TEST 8: Booking Confirmation Service
    const hold4 = await request('POST', `/seats/${s4}/hold`);
    const confirmRes = await confirmBooking(hold4.body.booking_ref, 'pay_test_100', 'evt_test_100', 400);
    await assert(confirmRes.success && confirmRes.payment.status === 'SUCCEEDED', 'confirmBooking() successfully confirms pending booking');

    const seat4Res = await query('SELECT status FROM seats WHERE id = $1', [s4]);
    await assert(seat4Res.rows[0].status === 'CONFIRMED', `Seat ${s4} status updated to CONFIRMED in DB`);

    // TEST 9: Attempt to hold CONFIRMED seat
    const hold4Confirmed = await request('POST', `/seats/${s4}/hold`);
    await assert(hold4Confirmed.status === 409, `POST /seats/${s4}/hold returns 409 Conflict for CONFIRMED seat`);

    // TEST 10: Payment Failure Release Service
    const hold5 = await request('POST', `/seats/${s5}/hold`);
    const failRes = await failBooking(hold5.body.booking_ref, 'pay_fail_100', 'evt_fail_100', 400);
    await assert(failRes.success && failRes.payment.status === 'FAILED', 'failBooking() handles payment failure');

    const seat5Res = await query('SELECT status FROM seats WHERE id = $1', [s5]);
    await assert(seat5Res.rows[0].status === 'AVAILABLE', `Seat ${s5} status reverted to AVAILABLE on payment failure`);

    // TEST 11: Duplicate Event Deduplication
    const dupRes = await confirmBooking(hold4.body.booking_ref, 'pay_test_100', 'evt_test_100', 400);
    await assert(dupRes.duplicate === true, 'confirmBooking() safely deduplicates duplicate event_id');

    // TEST 12: REAL CONCURRENCY TEST (100 concurrent requests targeting same seat)
    console.log('\n--- Running Real Concurrency Test (100 Concurrent Requests) ---');
    await query("UPDATE seats SET status = 'AVAILABLE', hold_expires_at = NULL, version = 0 WHERE id = $1", [s10]);
    await query("DELETE FROM bookings WHERE seat_id = $1", [s10]);

    const concurrentRequests = Array.from({ length: 100 }, () =>
      request('POST', `/seats/${s10}/hold`)
    );

    const results = await Promise.all(concurrentRequests);
    const successCount = results.filter((r) => r.status === 200).length;
    const conflictCount = results.filter((r) => r.status === 409).length;

    const dbSeat = await query('SELECT status, version FROM seats WHERE id = $1', [s10]);
    const dbBookings = await query('SELECT id FROM bookings WHERE seat_id = $1', [s10]);

    await assert(successCount === 1, `Exact 1 request succeeded (Got: ${successCount})`);
    await assert(conflictCount === 99, `Exact 99 requests rejected with 409 Conflict (Got: ${conflictCount})`);
    await assert(dbBookings.rows.length === 1, `Exact 1 booking created in PostgreSQL (Got: ${dbBookings.rows.length})`);
    await assert(dbSeat.rows[0].status === 'HELD', `Seat status in DB is HELD`);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    if (server) {
      server.close();
    }
    await pool.end();
  }

  console.log('\n==============================================');
  console.log(` TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('==============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
