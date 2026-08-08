-- CinemaSeat Full PostgreSQL Database Schema (Person 1)

CREATE TABLE IF NOT EXISTS movies (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  poster_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS theatres (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS showtimes (
  id BIGSERIAL PRIMARY KEY,
  movie_id BIGINT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  theatre_id BIGINT NOT NULL REFERENCES theatres(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_showtimes_movie_id ON showtimes(movie_id);
CREATE INDEX IF NOT EXISTS idx_showtimes_theatre_id ON showtimes(theatre_id);
CREATE INDEX IF NOT EXISTS idx_showtimes_start_time ON showtimes(start_time);

CREATE TABLE IF NOT EXISTS seats (
  id BIGSERIAL PRIMARY KEY,
  showtime_id BIGINT NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
  row_label VARCHAR(10) NOT NULL,
  col_num INT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
  hold_expires_at TIMESTAMPTZ NULL,
  version INT NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_seat_showtime_row_col UNIQUE(showtime_id, row_label, col_num)
);

CREATE INDEX IF NOT EXISTS idx_seats_showtime_id ON seats(showtime_id);
CREATE INDEX IF NOT EXISTS idx_seats_status ON seats(status);
CREATE INDEX IF NOT EXISTS idx_seats_hold_expires_at ON seats(hold_expires_at);

CREATE TABLE IF NOT EXISTS bookings (
  id BIGSERIAL PRIMARY KEY,
  seat_id BIGINT NOT NULL REFERENCES seats(id) ON DELETE RESTRICT,
  booking_ref VARCHAR(100) NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  booking_ref VARCHAR(100) NOT NULL REFERENCES bookings(booking_ref) ON DELETE RESTRICT,
  payment_id VARCHAR(150) UNIQUE,
  event_id VARCHAR(150) UNIQUE,
  status VARCHAR(30) NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_verifications (
  id BIGSERIAL PRIMARY KEY,
  booking_ref VARCHAR(100) NOT NULL REFERENCES bookings(booking_ref) ON DELETE CASCADE,
  phone VARCHAR(30) NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ NULL,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
