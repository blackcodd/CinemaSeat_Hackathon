# CinemaSeat Database Architecture & Specification

This document details the database design, schema relationships, indexing strategy, concurrency protection, state machine, and transaction flow for Person 1 (Core Backend & Database Owner).

---

## 1. Schema Overview & ER Diagram

```
movies (1) ───< showtimes (N) ───< seats (N) ───(1:1)─── bookings (1) ───< payments (N)
                    │                                         │
theatres (1) ───────┘                                         └───< otp_verifications (N)
```

---

## 2. Table Definitions

### 1. `movies`
Stores movie catalog metadata.
- `id` `BIGSERIAL PRIMARY KEY`
- `title` `VARCHAR(255) NOT NULL`
- `poster_url` `TEXT`
- `created_at` `TIMESTAMPTZ NOT NULL DEFAULT NOW()`

### 2. `theatres`
Stores theatre venue information.
- `id` `BIGSERIAL PRIMARY KEY`
- `name` `VARCHAR(150) NOT NULL`
- `created_at` `TIMESTAMPTZ NOT NULL DEFAULT NOW()`

### 3. `showtimes`
Links a movie to a theatre at a specific date and time.
- `id` `BIGSERIAL PRIMARY KEY`
- `movie_id` `BIGINT NOT NULL REFERENCES movies(id) ON DELETE CASCADE`
- `theatre_id` `BIGINT NOT NULL REFERENCES theatres(id) ON DELETE CASCADE`
- `start_time` `TIMESTAMPTZ NOT NULL`
- `created_at` `TIMESTAMPTZ NOT NULL DEFAULT NOW()`

**Indexes:**
- `idx_showtimes_movie_id` on `showtimes(movie_id)`
- `idx_showtimes_theatre_id` on `showtimes(theatre_id)`
- `idx_showtimes_start_time` on `showtimes(start_time)`

### 4. `seats`
The core table managing seat availability, row/column grid, hold expiration, and optimistic concurrency versioning.
- `id` `BIGSERIAL PRIMARY KEY`
- `showtime_id` `BIGINT NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE`
- `row_label` `VARCHAR(10) NOT NULL`
- `col_num` `INT NOT NULL`
- `price` `NUMERIC(10,2) NOT NULL CHECK (price >= 0)`
- `status` `VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'`
- `hold_expires_at` `TIMESTAMPTZ NULL`
- `version` `INT NOT NULL DEFAULT 0 CHECK (version >= 0)`
- `created_at` `TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at` `TIMESTAMPTZ NOT NULL DEFAULT NOW()`

**Constraints:**
- `UNIQUE(showtime_id, row_label, col_num)`: Guarantees no duplicate seat coordinates within the same showtime.

**Indexes:**
- `idx_seats_showtime_id` on `seats(showtime_id)`
- `idx_seats_status` on `seats(status)`
- `idx_seats_hold_expires_at` on `seats(hold_expires_at)`

### 5. `bookings`
Tracks reservation booking state and references seat holds.
- `id` `BIGSERIAL PRIMARY KEY`
- `seat_id` `BIGINT NOT NULL REFERENCES seats(id) ON DELETE RESTRICT`
- `booking_ref` `VARCHAR(100) NOT NULL UNIQUE`
- `status` `VARCHAR(30) NOT NULL`
- `created_at` `TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at` `TIMESTAMPTZ NOT NULL DEFAULT NOW()`

### 6. `payments`
Tracks payment transactions and webhook callback events.
- `id` `BIGSERIAL PRIMARY KEY`
- `booking_ref` `VARCHAR(100) NOT NULL REFERENCES bookings(booking_ref) ON DELETE RESTRICT`
- `payment_id` `VARCHAR(150) UNIQUE`
- `event_id` `VARCHAR(150) UNIQUE`
- `status` `VARCHAR(30) NOT NULL`
- `amount` `NUMERIC(10,2) NOT NULL CHECK (amount >= 0)`
- `created_at` `TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at` `TIMESTAMPTZ NOT NULL DEFAULT NOW()`

**Deduplication Constraint:**
- `UNIQUE(payments.event_id)`: Guarantees that duplicate payment callback events from payment gateways do not create duplicate transactions or double-confirm bookings.

### 7. `otp_verifications`
Stores OTP verification attempts for SMS authentication (owned by Person 2).
- `id` `BIGSERIAL PRIMARY KEY`
- `booking_ref` `VARCHAR(100) NOT NULL REFERENCES bookings(booking_ref) ON DELETE CASCADE`
- `phone` `VARCHAR(30) NOT NULL`
- `otp_hash` `TEXT NOT NULL`
- `expires_at` `TIMESTAMPTZ NOT NULL`
- `verified_at` `TIMESTAMPTZ NULL`
- `attempts` `INT NOT NULL DEFAULT 0 CHECK (attempts >= 0)`
- `created_at` `TIMESTAMPTZ NOT NULL DEFAULT NOW()`

---

## 3. State Machines

### Seat States
- `AVAILABLE`: Open for holding.
- `HELD`: Reserved temporarily for a user until `hold_expires_at`.
- `PAID` / `CONFIRMED`: Successfully purchased and confirmed.

### Booking States
- `PENDING`: Created upon holding a seat.
- `CONFIRMED`: Payment completed successfully.
- `EXPIRED`: Hold TTL elapsed without payment.
- `FAILED`: Payment failed or was rejected.
- `CANCELLED`: Explicitly cancelled.

---

## 4. Concurrency Protection Strategy (`SELECT FOR UPDATE`)

To prevent overselling when 100+ concurrent requests target the same seat at the exact same millisecond:

```sql
BEGIN;

-- 1. Acquire row-level exclusive lock on target seat
SELECT * FROM seats WHERE id = $1 FOR UPDATE;

-- 2. Validate seat availability
-- If status is CONFIRMED -> ROLLBACK & return 409 Conflict.
-- If status is HELD and hold_expires_at > NOW() -> ROLLBACK & return 409 Conflict.
-- If status is AVAILABLE (or expired HELD) -> Proceed.

-- 3. Update seat state and increment version
UPDATE seats 
SET status = 'HELD', 
    hold_expires_at = $expiresAt, 
    version = version + 1, 
    updated_at = NOW() 
WHERE id = $1;

-- 4. Create booking entry
INSERT INTO bookings (seat_id, booking_ref, status) VALUES ($1, $bookingRef, 'PENDING');

COMMIT;
```

**Why this guarantees zero oversell:**
- The first transaction locks the row with `FOR UPDATE`.
- Concurrent transactions for the same seat wait until the first transaction commits or rolls back.
- When subsequent transactions acquire the lock, they read the committed state (`status = HELD`) and immediately reject with `409 Conflict`.
- Result: Exactly 1 success, 99 rejections, 0 double-bookings.

---

## 5. Hold Expiry & Payment Services

### Expiry Worker Flow
A background process runs periodically:
```sql
SELECT id FROM seats WHERE status = 'HELD' AND hold_expires_at <= NOW() FOR UPDATE;
-- For each expired seat:
UPDATE seats SET status = 'AVAILABLE', hold_expires_at = NULL, version = version + 1 WHERE id = $id AND status = 'HELD';
UPDATE bookings SET status = 'EXPIRED' WHERE seat_id = $id AND status = 'PENDING';
```

### Person 2 Integration Services
- `confirmBooking(booking_ref, payment_id, event_id, amount)`: Idempotently transitions seat & booking to `CONFIRMED`.
- `failBooking(booking_ref, payment_id, event_id, amount)`: Idempotently transitions seat to `AVAILABLE` and booking to `FAILED`.
