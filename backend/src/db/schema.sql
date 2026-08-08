-- CinemaSeat Microservice Schema Specification

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  poster_url TEXT,
  runtime_minutes INT DEFAULT 120,
  rating TEXT DEFAULT 'PG-13',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS theatres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS screens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theatre_id UUID NOT NULL REFERENCES theatres(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS showtimes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_showtimes_movie ON showtimes(movie_id);
CREATE INDEX IF NOT EXISTS idx_showtimes_screen_starts ON showtimes(screen_id, starts_at);

CREATE TABLE IF NOT EXISTS seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  row_label TEXT NOT NULL,
  seat_number INT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'STANDARD',
  price NUMERIC(10,2) NOT NULL DEFAULT 400.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (screen_id, row_label, seat_number)
);

-- The core contested resource: one row per (showtime, seat)
CREATE TABLE IF NOT EXISTS seat_status (
  showtime_id UUID NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
  seat_id UUID NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('AVAILABLE','HELD','CONFIRMED')),
  held_by_booking_ref TEXT,
  hold_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (showtime_id, seat_id)
);

-- Second line of defense against oversell (belt-and-suspenders on top of Redis NX lock)
CREATE UNIQUE INDEX IF NOT EXISTS one_active_holder_per_seat
  ON seat_status (showtime_id, seat_id)
  WHERE status IN ('HELD','CONFIRMED');

CREATE INDEX IF NOT EXISTS idx_seat_status_showtime ON seat_status(showtime_id);

CREATE TABLE IF NOT EXISTS bookings (
  booking_ref TEXT PRIMARY KEY,
  showtime_id UUID NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
  seat_id UUID NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  user_id TEXT,
  status TEXT NOT NULL CHECK (status IN
    ('HELD','AWAITING_PAYMENT','CONFIRMED','FAILED','CANCELLED','REFUNDED')),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BDT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_showtime_seat ON bookings(showtime_id, seat_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS otp_verifications (
  ref TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- worker-service owned
CREATE TABLE IF NOT EXISTS payments (
  payment_id TEXT PRIMARY KEY,
  booking_ref TEXT NOT NULL REFERENCES bookings(booking_ref) ON DELETE CASCADE,
  status TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  raw_last_callback JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_booking_ref ON payments(booking_ref);

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(30) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'customer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
