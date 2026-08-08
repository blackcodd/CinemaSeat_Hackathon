const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { query, initDb } = require('./db');
const { holdSeat } = require('./services/bookingService');
const { startExpiryWorker } = require('./services/expiryWorker');
const { sendOtp, verifyOtp } = require('./services/otpService');
const { processPayment, handlePaymentWebhook, verifyWebhookSignature } = require('./services/paymentService');

const app = express();
app.use(cors());
app.use(express.json());

/**
 * HOOK 1: GET /health
 * Must respond in under 1 second without depending on external services / mock gateway.
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * GET /movies
 */
app.get('/movies', async (req, res, next) => {
  try {
    const result = await query('SELECT id, title, poster_url FROM movies ORDER BY id ASC');
    res.status(200).json(result.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /showtimes?movie_id=
 */
app.get('/showtimes', async (req, res, next) => {
  try {
    const { movie_id } = req.query;
    let sql = 'SELECT id, movie_id, theatre_id, start_time FROM showtimes';
    const params = [];

    if (movie_id) {
      sql += ' WHERE movie_id = $1';
      params.push(movie_id);
    }
    sql += ' ORDER BY start_time ASC';

    const result = await query(sql, params);
    res.status(200).json(result.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /seatmap/:showtime_id
 */
app.get('/seatmap/:showtime_id', async (req, res, next) => {
  try {
    const { showtime_id } = req.params;

    const showtimeRes = await query('SELECT id FROM showtimes WHERE id = $1', [showtime_id]);
    if (showtimeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Showtime not found' });
    }

    const seatsRes = await query(
      `SELECT id AS seat_id, row_label AS row, col_num AS col, status, price 
       FROM seats 
       WHERE showtime_id = $1 
       ORDER BY row_label ASC, col_num ASC`,
      [showtime_id]
    );

    res.status(200).json(seatsRes.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /seats/:seat_id/hold
 */
app.post('/seats/:seat_id/hold', async (req, res, next) => {
  try {
    const { seat_id } = req.params;
    const result = await holdSeat(seat_id);
    res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * ========================================================
 * PERSON 2 ROUTES — PAYMENT, WEBHOOKS, & OTP
 * ========================================================
 */

/**
 * POST /pay
 * Process payment with Mock Gateway, supporting Idempotency-Key and control headers.
 */
app.post('/pay', async (req, res, next) => {
  try {
    const { booking_ref, amount, phone } = req.body;
    const idempotency_key = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    
    const result = await processPayment({
      booking_ref,
      amount,
      phone,
      idempotency_key,
      headers: req.headers,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /otp/send
 */
app.post('/otp/send', async (req, res, next) => {
  try {
    const { booking_ref, phone } = req.body;
    const result = await sendOtp(booking_ref, phone);
    res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /otp/verify
 */
app.post('/otp/verify', async (req, res, next) => {
  try {
    const { booking_ref, otp } = req.body;
    const result = await verifyOtp(booking_ref, otp);
    res.status(200).json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /webhooks/payment & POST /gateway/callback
 */
const handleWebhook = async (req, res, next) => {
  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }

    await handlePaymentWebhook(req.body);
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Webhook should respond HTTP 200 to gateway unless payload is bad
    res.status(200).json({ status: 'ok', warning: err.message });
  }
};

app.post('/webhooks/payment', handleWebhook);
app.post('/gateway/callback', handleWebhook);

// Central Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
  });
});

const PORT = process.env.PORT || 4000;

async function startServer() {
  try {
    console.log('Initializing database schema and seed data...');
    await initDb();
    console.log('Database initialized successfully.');

    startExpiryWorker(2000);

    if (process.env.NODE_ENV !== 'test') {
      app.listen(PORT, () => {
        console.log(`CinemaSeat Backend running on port ${PORT}`);
      });
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

module.exports = { app, startServer };
