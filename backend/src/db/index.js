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

    // 1. Idempotent Movies
    await client.query(`
      INSERT INTO movies (id, title, poster_url) VALUES
      (1, 'Spider-Man: Brand New Day', 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=600&auto=format&fit=crop&q=80'),
      (2, 'Interstellar', 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=600&auto=format&fit=crop&q=80'),
      (3, 'The Dark Knight', 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80')
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, poster_url = EXCLUDED.poster_url;
    `);

    await client.query(`SELECT setval('movies_id_seq', (SELECT GREATEST(MAX(id), 1) FROM movies));`);

    // 2. Idempotent Theatres
    await client.query(`
      INSERT INTO theatres (id, name) VALUES
      (1, 'Star Cineplex - Bashundhara'),
      (2, 'Blockbuster Cinemas - Jamuna')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
    `);

    await client.query(`SELECT setval('theatres_id_seq', (SELECT GREATEST(MAX(id), 1) FROM theatres));`);

    // 3. Idempotent Showtimes for ALL movies
    const now = new Date();
    const st1 = new Date(now.getTime() + 3600 * 1000).toISOString();
    const st2 = new Date(now.getTime() + 7200 * 1000).toISOString();
    const st3 = new Date(now.getTime() + 10800 * 1000).toISOString();
    const st4 = new Date(now.getTime() + 14400 * 1000).toISOString();
    const st5 = new Date(now.getTime() + 18000 * 1000).toISOString();

    await client.query(`
      INSERT INTO showtimes (id, movie_id, theatre_id, start_time) VALUES
      (1, 1, 1, $1),
      (2, 1, 2, $2),
      (3, 2, 1, $3),
      (4, 2, 2, $4),
      (5, 3, 1, $5)
      ON CONFLICT (id) DO NOTHING;
    `, [st1, st2, st3, st4, st5]);

    await client.query(`SELECT setval('showtimes_id_seq', (SELECT GREATEST(MAX(id), 1) FROM showtimes));`);

    // 4. Idempotent Seats (Rows A, B, C, D x Cols 1-8 for showtimes 1..5)
    const rows = [
      { label: 'A', price: 400 },
      { label: 'B', price: 400 },
      { label: 'C', price: 500 },
      { label: 'D', price: 500 }
    ];

    const showtimeIds = [1, 2, 3, 4, 5];

    for (const stId of showtimeIds) {
      for (const row of rows) {
        for (let col = 1; col <= 8; col++) {
          await client.query(`
            INSERT INTO seats (showtime_id, row_label, col_num, price, status, hold_expires_at, version)
            VALUES ($1, $2, $3, $4, 'AVAILABLE', NULL, 0)
            ON CONFLICT (showtime_id, row_label, col_num) DO NOTHING;
          `, [stId, row.label, col, row.price]);
        }
      }
    }

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
