const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { query, initDb } = require('./db');
const { holdSeat } = require('./services/bookingService');
const { startExpiryWorker } = require('./services/expiryWorker');

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

    // Check if showtime exists
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
