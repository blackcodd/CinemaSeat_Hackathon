# CinemaSeat - High-Concurrency Movie Seat Booking System

[![CI/CD Pipeline](https://github.com/blackcodd/CinemaSeat_Hackathon/actions/workflows/ci.yml/badge.svg)](https://github.com/blackcodd/CinemaSeat_Hackathon/actions/workflows/ci.yml)

CinemaSeat is a high-concurrency movie reservation system built with Node.js (Express), PostgreSQL, Docker, and Vanilla JS SPA. It is engineered to withstand extreme traffic spikes during blockbuster movie releases without ever double-booking a seat.

---

## 🏛 System Architecture & CI/CD Pipeline

### System Architecture Diagram
```text
                               ┌────────────────────────┐
                               │     Browser Client     │
                               └───────────┬────────────┘
                                           │
                                           v
                               ┌────────────────────────┐
                               │   Frontend (port 3000) │
                               └───────────┬────────────┘
                                           │
                                           v
                               ┌────────────────────────┐
                               │   Backend (port 4000)  │
                               └───────┬────────┬───────┘
                                       │        │
                     ┌─────────────────┘        └─────────────────┐
                     │                                            │
                     v                                            v
        ┌────────────────────────┐                   ┌────────────────────────┐
        │  PostgreSQL (port 5432)│                   │ Mock Gateway(port 9000)│
        └────────────────────────┘                   └────────────┬───────────┘
                     ▲                                            │
                     │                 Payment & OTP Callbacks    │
                     └────────────────────────────────────────────┘
```

### CI/CD Pipeline Diagram
```text
[ Git Push / PR ] ──> [ GitHub Actions Runner ]
                              │
                              ├──> 1. Setup Node.js & PostgreSQL Container
                              ├──> 2. Install Dependencies (`npm install`)
                              └──> 3. Run Test Suite (`npm test`) -> 31/31 PASSED
```

---

## 🚀 Quick Start (Clean Clone Setup)

Run the full containerized environment (PostgreSQL database, Mock Gateway, Backend API, and Frontend) with a single command:

```bash
docker compose up --build
```

### Services & Ports
- **Frontend Client:** `http://localhost:3000`
- **Backend API:** `http://localhost:4000`
- **Mock Payment Gateway:** `http://localhost:9000`
- **PostgreSQL Database:** `localhost:5432`

---

## 🎯 Mandatory Judging Hook Requests

### 1. Request to Fetch Seat Map (`GET /seatmap/:showtime_id`)
```bash
curl -i http://localhost:4000/seatmap/1
```
**Response (200 OK):**
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

### 2. Request to Hold a Seat (`POST /seats/:seat_id/hold`)
```bash
curl -i -X POST http://localhost:4000/seats/1/hold \
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

### 3. Health Check Hook (`GET /health`)
```bash
curl -i http://localhost:4000/health
```
**Response:** `{"status": "ok"}` (Responds in < 1ms even when gateway container is stopped).

---

## 📌 Complete API Contract & Examples

### Fetch Movies
```bash
curl http://localhost:4000/movies
```

### Fetch Showtimes
```bash
curl "http://localhost:4000/showtimes?movie_id=1"
```

### Process Payment (Person 2 Integration)
```bash
curl -X POST http://localhost:4000/pay \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: payment-REF-1723112400000-849201" \
  -d '{"booking_ref":"REF-1723112400000-849201","phone":"+8801700000000","amount":400}'
```

### Send & Verify OTP
```bash
# Send OTP (Deterministic Mode code 123456)
curl -X POST http://localhost:4000/otp/send \
  -H "Content-Type: application/json" \
  -H "X-Mock-Mode: deterministic" \
  -d '{"booking_ref":"REF-1723112400000-849201","phone":"+8801700000000"}'

# Verify OTP
curl -X POST http://localhost:4000/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"booking_ref":"REF-1723112400000-849201","otp":"123456"}'
```

### Poll Booking & Payment Status (Person 3 Read-only Endpoint)
```bash
curl http://localhost:4000/bookings/REF-1723112400000-849201
```

---

## ⚡ Concurrency, Hold TTL & Milestone 4 Verification

- **Scenario A (100 Concurrent Virtual Users on One Seat):**
  Uses PostgreSQL row-level locks (`SELECT FOR UPDATE`) inside database transactions. When 100 requests arrive in the exact same millisecond for seat #1:
  - **1 request succeeds** (`200 OK`)
  - **99 requests are rejected** (`409 Conflict`)
  - **Oversell count: EXACTLY 0**

- **Scenario B (The Abandoned Hold):**
  A background worker running at interval `HOLD_TTL_SECONDS` (read from environment, default `60` seconds) checks expired holds and automatically reverts seat status from `HELD` back to `AVAILABLE`.

- **Scenario C (K6 Load Testing Suite):**
  ```bash
  # Run 100 VU concurrent seat hold test
  k6 run k6/seat-hold.js

  # Run read endpoint load test
  k6 run k6/read-apis.js
  ```

---

## 📄 Documentation Links
- [Architectural Decisions Record (`DECISIONS.md`)](DECISIONS.md)
- [System Architecture & Sequence Flows (`docs/ARCHITECTURE.md`)](docs/ARCHITECTURE.md)
- [Payment Gateway & OTP Integration Architecture (`docs/PAYMENT.md`)](docs/PAYMENT.md)
- [Database Schema & Architecture Documentation (`docs/DATABASE.md`)](docs/DATABASE.md)
- [API Contract Specification (`docs/API_CONTRACT.md`)](docs/API_CONTRACT.md)
- [K6 Load Testing Documentation (`k6/README.md`)](k6/README.md)
