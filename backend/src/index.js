const express = require('express');
const cors = require('cors');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Redis } = require('ioredis');
const { query } = require('./db');
const bookingService = require('./services/bookingService');
const { enqueueWebhookEvent } = require('./lib/redis');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || 'z2p-2026-secret';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Capture raw body for HMAC SHA-256 verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(cors());

// Structured Request Logging Middleware
app.use((req, res, next) => {
  const start = Date.now();
  req.requestId = crypto.randomUUID();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health') {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
      }));
    }
  });
  next();
});

// WebSocket Server for Realtime Seat Map updates (/ws/showtimes/:id)
const wss = new WebSocketServer({ noServer: true });
const clientsByShowtime = new Map(); // showtimeId -> Set of ws clients

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const match = url.pathname.match(/^\/ws\/showtimes\/([^/]+)$/);
  if (match) {
    const showtimeId = match[1];
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.showtimeId = showtimeId;
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  const showtimeId = ws.showtimeId;
  if (!clientsByShowtime.has(showtimeId)) {
    clientsByShowtime.set(showtimeId, new Set());
  }
  clientsByShowtime.get(showtimeId).add(ws);

  // Send initial room membership viewer count
  const viewerCount = clientsByShowtime.get(showtimeId).size;
  ws.send(JSON.stringify({ type: 'VIEWER_COUNT', count: viewerCount }));

  ws.on('close', () => {
    if (clientsByShowtime.has(showtimeId)) {
      clientsByShowtime.get(showtimeId).delete(ws);
    }
  });
});

// Subscribe to Redis Pub/Sub for seat state updates and broadcast to WS clients
const redisSub = new Redis(REDIS_URL);
redisSub.psubscribe('showtime:*:seats', (err) => {
  if (err) console.error('Redis PubSub subscribe error:', err);
});

redisSub.on('pmessage', (pattern, channel, message) => {
  const match = channel.match(/^showtime:(.+):seats$/);
  if (match) {
    const showtimeId = match[1];
    const clients = clientsByShowtime.get(showtimeId);
    if (clients) {
      for (const client of clients) {
        if (client.readyState === 1) { // OPEN
          client.send(message);
        }
      }
    }
  }
});

/**
 * 1. Independent Health Check (GET /health)
 * Must return 200 in <1s independently of Gateway status
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * 2. System Metrics (GET /metrics)
 */
app.get('/metrics', async (req, res, next) => {
  try {
    const totalBookingsRes = await query('SELECT COUNT(*) FROM bookings');
    const confirmedRes = await query("SELECT COUNT(*) FROM bookings WHERE status = 'CONFIRMED'");
    const failedRes = await query("SELECT COUNT(*) FROM bookings WHERE status = 'FAILED'");
    const heldRes = await query("SELECT COUNT(*) FROM seat_status WHERE status = 'HELD'");

    res.status(200).json({
      uptimeSeconds: process.uptime(),
      totalBookings: parseInt(totalBookingsRes.rows[0].count, 10),
      confirmedBookings: parseInt(confirmedRes.rows[0].count, 10),
      failedBookings: parseInt(failedRes.rows[0].count, 10),
      currentHeldSeats: parseInt(heldRes.rows[0].count, 10),
      memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Auth Routes
 */
app.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const result = await query(
      'SELECT id, name, email, phone, role, password FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );
    if (result.rows.length === 0 || result.rows[0].password !== password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const { password: _, ...userData } = result.rows[0];
    res.status(200).json({ message: 'Login successful', user: userData, token: `token_${userData.id}` });
  } catch (err) {
    next(err);
  }
});

app.get('/auth/users', async (req, res, next) => {
  try {
    const result = await query('SELECT id, name, email, phone, role FROM users ORDER BY created_at ASC');
    res.status(200).json(result.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * Browsing Routes
 */
app.get('/movies', async (req, res, next) => {
  try {
    const result = await query('SELECT id, title, poster_url, runtime_minutes, rating FROM movies ORDER BY title ASC');
    res.status(200).json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get('/movies/:id/showtimes', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT st.id, st.movie_id, st.screen_id, st.starts_at, t.name as theatre_name
      FROM showtimes st
      JOIN screens sc ON sc.id = st.screen_id
      JOIN theatres t ON t.id = sc.theatre_id
      WHERE st.movie_id = $1
      ORDER BY st.starts_at ASC;
    `, [req.params.id]);
    res.status(200).json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get(['/showtimes/:id/seats', '/seatmap/:id'], async (req, res, next) => {
  try {
    const seatmap = await bookingService.getSeatMap(req.params.id);
    res.status(200).json(seatmap);
  } catch (err) {
    next(err);
  }
});

/**
 * Seat Hold Endpoint (POST /bookings/hold & aliases)
 */
app.post(['/bookings/hold', '/seats/hold', '/seats/:id/hold'], async (req, res, next) => {
  try {
    const showtimeId = req.body.showtime_id || req.body.showtimeId;
    const seatId = req.params.id || req.body.seat_id || req.body.seatId;
    const seatIds = req.body.seat_ids || req.body.seatIds;
    const userId = req.body.user_id || req.body.userId;

    const result = await bookingService.holdSeat({
      showtimeId,
      seatId,
      seatIds,
      userId,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * OTP Routes
 */
app.post(['/bookings/:ref/otp/send', '/otp/send'], async (req, res, next) => {
  try {
    const ref = req.params.ref || req.body.booking_ref || req.body.reference;
    const phone = req.body.phone || '01700000000';
    const result = await bookingService.sendOtp(ref, phone);
    res.status(200).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

app.post(['/bookings/:ref/otp/verify', '/otp/verify'], async (req, res, next) => {
  try {
    const ref = req.params.ref || req.body.booking_ref || req.body.reference;
    const code = req.body.code || req.body.otp;
    const result = await bookingService.verifyOtp(ref, code);
    res.status(200).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/**
 * Payment & Booking Management Routes
 */
app.post(['/bookings/:ref/pay', '/pay'], async (req, res, next) => {
  try {
    const ref = req.params.ref || req.body.booking_ref;
    const result = await bookingService.initiatePayment(ref, req.body);
    res.status(202).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

app.get('/bookings/:ref', async (req, res, next) => {
  try {
    const booking = await bookingService.getBooking(req.params.ref);
    res.status(200).json(booking);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

app.post('/bookings/:ref/cancel', async (req, res, next) => {
  try {
    const result = await bookingService.cancelBooking(req.params.ref);
    res.status(200).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/**
 * Webhook Endpoint (POST /webhooks/payment)
 * Fast ACK path (<10ms):
 * 1. Verify HMAC signature
 * 2. Deduplicate event_id in processed_webhook_events
 * 3. Enqueue payload to Redis Queue
 * 4. Return 200 OK immediately
 */
app.post(['/webhooks/payment', '/webhooks/otp'], async (req, res, next) => {
  try {
    const signature = req.headers['x-signature'];

    // Verify HMAC signature if present
    if (signature && req.rawBody) {
      const computedHash = crypto
        .createHmac('sha256', GATEWAY_SECRET)
        .update(req.rawBody)
        .digest('hex');

      if (computedHash !== signature) {
        console.warn('Invalid Webhook HMAC Signature');
        return res.status(401).json({ error: 'Invalid HMAC signature' });
      }
    }

    const { event_id, payment_id, booking_ref, status } = req.body;

    if (event_id) {
      // Fast DB insert for deduplication gate
      const dedupRes = await query(
        'INSERT INTO processed_webhook_events (event_id, received_at) VALUES ($1, NOW()) ON CONFLICT (event_id) DO NOTHING',
        [event_id]
      );

      // If 0 rows affected -> Duplicate event, return 200 OK immediately
      if (dedupRes.rowCount === 0) {
        return res.status(200).json({ status: 'duplicate_ignored' });
      }
    }

    // Push event to Redis Queue for async worker service
    await enqueueWebhookEvent({
      event_id: event_id || `evt_${Date.now()}`,
      payment_id,
      booking_ref,
      status,
      raw_payload: req.body,
    });

    // Fast ACK in single-digit ms
    res.status(200).json({ status: 'queued' });
  } catch (err) {
    console.error('Error handling webhook:', err);
    res.status(200).json({ status: 'error_handled' });
  }
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.message, err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

// Start Server & Seed Database on Startup
if (require.main === module) {
  server.listen(PORT, async () => {
    console.log(`[API Service] Running on port ${PORT}`);
    try {
      const { initDb } = require('./db');
      await initDb();
      console.log('[API Service] Database initialized & seeded successfully.');
    } catch (err) {
      console.error('[API Service] Database initialization error:', err.message);
    }
  });
}

module.exports = { app, server };
