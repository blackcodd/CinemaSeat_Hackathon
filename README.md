# CinemaSeat - High-Concurrency Movie Seat Booking System

CinemaSeat is a Node.js (Express) + PostgreSQL high-concurrency movie reservation system built for zero oversell under heavy load.

---

## 🚀 Quick Start (Clean Clone Setup)

Run the complete environment (PostgreSQL database, Mock Gateway, Backend API, and Frontend) with Docker Compose:

```bash
docker compose up --build
```

### Services & Ports
- **Backend API:** `http://localhost:4000`
- **Frontend Client:** `http://localhost:3000`
- **Mock Payment Gateway:** `http://localhost:9000`
- **PostgreSQL Database:** `localhost:5432`

---

## ⚙️ Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://cinemaseat:cinemaseat@postgres:5432/cinemaseat` |
| `HOLD_TTL_SECONDS` | Duration in seconds before a held seat expires | `60` |
| `GATEWAY_URL` | URL of mock payment gateway | `http://gateway:9000` |
| `GATEWAY_SECRET` | Secret key for HMAC-SHA256 signature verification | `z2p-2026-secret` |
| `PORT` | Backend HTTP port | `4000` |

---

## 📌 API Usage & Examples

### 1. Health Check (Lightweight Local Health)
```bash
curl -i http://localhost:4000/health
```
**Response:** `HTTP/1.1 200 OK`
```json
{ "status": "ok" }
```

### 2. Fetch Movies
```bash
curl http://localhost:4000/movies
```
**Response:**
```json
[
  {
    "id": 1,
    "title": "Interstellar",
    "poster_url": "/posters/interstellar.jpg"
  },
  {
    "id": 2,
    "title": "Inception",
    "poster_url": "/posters/inception.jpg"
  }
]
```

### 3. Fetch Showtimes
```bash
curl "http://localhost:4000/showtimes?movie_id=1"
```
**Response:**
```json
[
  {
    "id": 1,
    "movie_id": 1,
    "theatre_id": 1,
    "start_time": "2026-08-08T19:00:00Z"
  }
]
```

### 4. Fetch Seat Map
```bash
curl http://localhost:4000/seatmap/1
```
**Response:**
```json
[
  {
    "seat_id": 1,
    "row": "A",
    "col": 1,
    "status": "AVAILABLE",
    "price": 400
  },
  {
    "seat_id": 2,
    "row": "A",
    "col": 2,
    "status": "HELD",
    "price": 400
  }
]
```

### 5. Hold a Seat (Core Concurrency Endpoint)
```bash
curl -X POST http://localhost:4000/seats/1/hold \
  -H "Content-Type: application/json"
```
**Response (200 OK):**
```json
{
  "hold_id": "REF-1723112400000-849201",
  "expires_at": "2026-08-08T19:01:00.000Z",
  "booking_ref": "REF-1723112400000-849201"
}
```

### 6. Process Payment (Person 2 Integration)
```bash
curl -X POST http://localhost:4000/pay \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: payment-REF-1723112400000-849201" \
  -d '{"booking_ref":"REF-1723112400000-849201","phone":"+8801700000000"}'
```
**Response (200/202 PENDING):**
```json
{
  "payment_id": "pay_1786166051876_7620",
  "status": "PENDING",
  "booking_ref": "REF-1723112400000-849201",
  "amount": 400
}
```

### 7. Send & Verify OTP (Person 2 Authentication)
```bash
# Send OTP
curl -X POST http://localhost:4000/otp/send \
  -H "Content-Type: application/json" \
  -H "X-Mock-Mode: deterministic" \
  -d '{"booking_ref":"REF-1723112400000-849201","phone":"+8801700000000"}'

# Verify OTP (deterministic code 123456)
curl -X POST http://localhost:4000/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"booking_ref":"REF-1723112400000-849201","otp":"123456"}'
```

---

## 🔒 Concurrency & Hold TTL Behavior

- **Zero Oversell Protection:** Seat hold reservations use PostgreSQL row-level locks (`SELECT FOR UPDATE`) inside database transactions. When 100 requests arrive at the exact same millisecond for seat #1, exactly **1 request succeeds** and **99 requests are safely rejected** with `409 Conflict`.
- **Hold Expiry (`HOLD_TTL_SECONDS`):** If a user holds a seat but does not complete payment within `HOLD_TTL_SECONDS` (e.g. 60 seconds), a background worker automatically reverts the seat status back from `HELD` to `AVAILABLE` and marks the booking `EXPIRED`.

---

## 📄 Documentation
- [Database Schema & Architecture Documentation (`docs/DATABASE.md`)](docs/DATABASE.md)
- [Payment Gateway & OTP Integration Architecture (`docs/PAYMENT.md`)](docs/PAYMENT.md)
- [API Contract Specification (`docs/API_CONTRACT.md`)](docs/API_CONTRACT.md)
