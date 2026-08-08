-- CinemaSeat Database Schema

CREATE TABLE movies (
  id SERIAL PRIMARY KEY,
  title TEXT,
  poster_url TEXT
);

CREATE TABLE theatres (
  id SERIAL PRIMARY KEY,
  name TEXT
);

CREATE TABLE showtimes (
  id SERIAL PRIMARY KEY,
  movie_id INT REFERENCES movies(id),
  theatre_id INT REFERENCES theatres(id),
  start_time TIMESTAMP
);

CREATE TABLE seats (
  id SERIAL PRIMARY KEY,
  showtime_id INT REFERENCES showtimes(id),
  row_label TEXT,
  col_num INT,
  price NUMERIC,
  status TEXT DEFAULT 'AVAILABLE',
  hold_expires_at TIMESTAMP,
  version INT DEFAULT 0
);

CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  seat_id INT REFERENCES seats(id),
  booking_ref TEXT UNIQUE,
  status TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  booking_ref TEXT,
  payment_id TEXT UNIQUE,
  event_id TEXT UNIQUE,
  status TEXT,
  amount NUMERIC
);
