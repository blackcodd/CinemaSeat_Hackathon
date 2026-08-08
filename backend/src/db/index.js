const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL || 'postgres://cinemaseat:cinemaseat@localhost:5432/cinemaseat';

const pool = new Pool({
  connectionString,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

async function initDb() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
  await seedDb();
}

async function seedDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fixed UUIDs for deterministic seed data
    const MOVIE_1_ID = '11111111-1111-4111-8111-111111111111';
    const MOVIE_2_ID = '22222222-2222-4222-8222-222222222222';
    const MOVIE_3_ID = '33333333-3333-4333-8333-333333333333';

    const THEATRE_1_ID = '44444444-4444-4444-8444-444444444444';
    const SCREEN_1_ID = '55555555-5555-4555-8555-555555555555';

    const SHOWTIME_1_ID = '66666666-6666-4666-8666-666666666666';
    const SHOWTIME_2_ID = '77777777-7777-4777-8777-777777777777';
    const SHOWTIME_3_ID = '88888888-8888-4888-8888-888888888888';

    // 1. Fictional Movies (No trademarked names as specified in Section 3.4)
    await client.query(`
      INSERT INTO movies (id, title, poster_url, runtime_minutes, rating) VALUES
      ($1, 'Cosmic Horizon: Odyssey', 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=600&auto=format&fit=crop&q=80', 148, 'PG-13'),
      ($2, 'Cyber Dawn 2099', 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=600&auto=format&fit=crop&q=80', 132, 'R'),
      ($3, 'Shadow Protocol: Genesis', 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80', 155, 'PG-13')
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, poster_url = EXCLUDED.poster_url;
    `, [MOVIE_1_ID, MOVIE_2_ID, MOVIE_3_ID]);

    // 2. Theatres & Screens
    await client.query(`
      INSERT INTO theatres (id, name, address) VALUES
      ($1, 'Star Cineplex - Bashundhara', 'Panthapath, Dhaka')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
    `, [THEATRE_1_ID]);

    await client.query(`
      INSERT INTO screens (id, theatre_id, name) VALUES
      ($1, $2, 'Screen 1 - IMAX Hall')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
    `, [SCREEN_1_ID, THEATRE_1_ID]);

    // 3. Showtimes
    const now = new Date();
    const st1 = new Date(now.getTime() + 3600 * 1000).toISOString();
    const st2 = new Date(now.getTime() + 7200 * 1000).toISOString();
    const st3 = new Date(now.getTime() + 10800 * 1000).toISOString();

    await client.query(`
      INSERT INTO showtimes (id, movie_id, screen_id, starts_at) VALUES
      ($1, $2, $3, $4),
      ($5, $6, $3, $7),
      ($8, $9, $3, $10)
      ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at;
    `, [
      SHOWTIME_1_ID, MOVIE_1_ID, SCREEN_1_ID, st1,
      SHOWTIME_2_ID, MOVIE_2_ID, st2,
      SHOWTIME_3_ID, MOVIE_3_ID, st3,
    ]);

    // 4. Seats & Seat Status Grid
    const rows = [
      { label: 'A', price: 400 },
      { label: 'B', price: 400 },
      { label: 'C', price: 500 },
      { label: 'D', price: 500 }
    ];

    const showtimes = [SHOWTIME_1_ID, SHOWTIME_2_ID, SHOWTIME_3_ID];

    for (const row of rows) {
      for (let col = 1; col <= 8; col++) {
        // Insert seat into screen
        const seatRes = await client.query(`
          INSERT INTO seats (screen_id, row_label, seat_number, tier, price)
          VALUES ($1, $2, $3, 'STANDARD', $4)
          ON CONFLICT (screen_id, row_label, seat_number) 
          DO UPDATE SET price = EXCLUDED.price
          RETURNING id;
        `, [SCREEN_1_ID, row.label, col, row.price]);

        const seatId = seatRes.rows[0].id;

        // Initialize seat_status for all showtimes
        for (const stId of showtimes) {
          await client.query(`
            INSERT INTO seat_status (showtime_id, seat_id, status)
            VALUES ($1, $2, 'AVAILABLE')
            ON CONFLICT (showtime_id, seat_id) DO NOTHING;
          `, [stId, seatId]);
        }
      }
    }

    // 5. Dummy Users
    await client.query(`
      INSERT INTO users (id, name, email, phone, password, role) VALUES
      ('00000000-0000-4000-8000-000000000001', 'Zayan Ahmed', 'zayan@example.com', '01700000000', 'password123', 'vip'),
      ('00000000-0000-4000-8000-000000000002', 'CUET Student', 'cuet.student@example.com', '01800000000', 'password123', 'student'),
      ('00000000-0000-4000-8000-000000000003', 'CinemaSeat Admin', 'admin@cinemaseat.com', '01900000000', 'admin123', 'admin')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone;
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding database:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  getClient,
  initDb,
  seedDb,
};
