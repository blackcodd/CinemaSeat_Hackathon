# 🎬 CinemaSeat — High-Concurrency Cinema Ticketing System

[![CI/CD Pipeline](https://github.com/blackcodd/CinemaSeat_Hackathon/actions/workflows/ci.yml/badge.svg)](https://github.com/blackcodd/CinemaSeat_Hackathon/actions/workflows/ci.yml)
**Zero-Oversell Engine under Blockbuster Release Demand**  
*The Ultimate Hackathon — Phase 2*

---

## 📑 Quick Navigation for Judges

- [⚖️ Mandatory Judging Hooks](#-mandatory-judging-hooks)
- [🏛 System Architecture & Pipeline Diagram](#-system-architecture--pipeline-diagram)
- [📊 Milestone 4 Performance Reports (Scenarios A, B & C)](#-milestone-4-performance-reports-scenarios-a-b--c)
- [🚀 Quick Start (Clean Clone setup)](#-quick-start-clean-clone-setup)
- [🛠 API Reference & Endpoints](#-api-reference--endpoints)
- [🧠 Architectural Decisions (`DECISIONS.md`)](DECISIONS.md)
- [📘 Detailed Architecture Documentation (`docs/ARCHITECTURE.md`)](docs/ARCHITECTURE.md)

---

## ⚖️ Mandatory Judging Hooks

Judges can test our system identically using these four exact specification hooks:

### Hook 1: Independent Health Check (`GET /health`)
```bash
curl -i http://localhost:4000/health
```
- **Response Time:** `< 1ms`
- **Behavior:** Returns `200 OK` (`{"status":"ok"}`) instantly from memory without external network calls, ensuring health stays green even if the Mock Gateway container is stopped.

### Hook 2: Configurable Hold Expiry (`HOLD_TTL_SECONDS`)
- **Environment Variable:** `HOLD_TTL_SECONDS` (read dynamically from environment/docker-compose, default `60`).
- **Behavior:** Background worker process cleans up expired holds automatically without hardcoded durations.

### Hook 3: Exact Required API Requests

#### A. Request to Fetch Seat Map (`GET /seatmap/:showtime_id`)
```bash
curl -i http://localhost:4000/seatmap/1
```
**Response (`200 OK`):**
```json
[
  { "seat_id": 1, "row": "A", "col": 1, "status": "AVAILABLE", "price": 400 },
  { "seat_id": 2, "row": "A", "col": 2, "status": "HELD", "price": 400 }
]
```

#### B. Request to Hold a Seat (`POST /seats/:seat_id/hold`)
```bash
curl -i -X POST http://localhost:4000/seats/1/hold \
  -H "Content-Type: application/json"
```
**Response (`200 OK`):**
```json
{
  "hold_id": "REF-1786167360000-8912",
  "expires_at": "2026-08-08T19:01:00.000Z",
  "booking_ref": "REF-1786167360000-8912"
}
```

### Hook 4: Clean Clone One-Command Launch (`docker compose up`)
```bash
git clone https://github.com/blackcodd/CinemaSeat_Hackathon.git
cd CinemaSeat_Hackathon
docker compose up --build
```
No manual setup required. Pre-populates database with movies, showtimes, seats, and starts Mock Gateway on port 9000.

---

## 🏛 System Architecture & Pipeline Diagram

### Architecture Flow Diagram
```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CinemaSeat Web Client                            │
│                        (Vanilla JS SPA on Port 3000)                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP API Calls
                                       v
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Backend Express API                             │
│                           (Node.js on Port 4000)                            │
│  - Request-ID Structured Logging    - Independent /health Endpoint          │
│  - GET /metrics Observability       - Status Polling /bookings/:ref        │
└───────────────┬─────────────────────────────────────────────┬───────────────┘
                │ SQL Transactions                            │ Async HTTP
                │ (SELECT FOR UPDATE)                         │ /charge & /otp
                v                                             v
┌──────────────────────────────┐              ┌──────────────────────────────┐
│  PostgreSQL Database (5432)  │              │   Mock Gateway (Port 9000)   │
│ - Strict Unique Constraints  │              │ - Delay: 2-15s | Fails: 10%  │
│ - Zero-Oversell Locks        │              │ - Duplicates: 8%             │
└──────────────────────────────┘              └──────────────┬───────────────┘
                ▲                                            │
                │              HMAC Signed Callbacks         │
                └────────────────────────────────────────────┘
```

### CI/CD Pipeline Diagram
```text
[ Developer Push / Pull Request to main ]
                   │
                   v
┌──────────────────────────────────────────────────┐
│              GitHub Actions Runner               │
│  1. Spin up PostgreSQL 16 Service Container      │
│  2. Install Node.js 18 & Dependencies            │
│  3. Run Complete Integration Test Suite          │
│     -> 31 PASSED / 0 FAILED                      │
└──────────────────┬───────────────────────────────┘
                   │ Pass
                   v
┌──────────────────────────────────────────────────┐
│          Deployable Containerized Stack          │
│        (AWS EC2 / Poridhi Cloud VM Instance)     │
└──────────────────────────────────────────────────┘
```

---

## 📊 Milestone 4 Performance Reports (Scenarios A, B & C)

### Scenario A: One Seat, 100 Buyers (Concurrency Burst Test)
We targeted seat #10 with 100 concurrent Virtual User requests in the exact same millisecond:
- **Total Requests Sent:** `100`
- **Successful Holds (`200 OK`):** `1`
- **Rejections (`409 Conflict`):** `99`
- **Oversell Count:** **`0` (EXACTLY ZERO)**
- **Database Verification:** PostgreSQL `seats` table reflects status `HELD` for exactly 1 row with exactly 1 corresponding row in `bookings`.

### Scenario B: The Abandoned Hold Expiry Timeline
- **Timeline:**
  - `t = 0s`: User holds Seat A2 (`status = HELD`, `hold_expires_at = NOW() + 60s`).
  - `t = 1s..59s`: Seat remains locked (`409 Conflict` for other buyers).
  - `t = 60s`: Expiry background worker executes `UPDATE seats SET status = 'AVAILABLE' WHERE hold_expires_at <= NOW()`.
  - `t = 61s`: Another user attempts `POST /seats/2/hold` -> **`200 OK` (Successfully booked by second user)**.

### Scenario C: System Breakpoint & Bottleneck Explanation
- **Test Command:** `k6 run k6/read-apis.js`
- **Observed Breakpoint:** ~450 requests/sec per API replica.
- **p95 Latency Knee:** Inflects upward past 500 VUs.
- **Bottleneck Analysis:** Database connection pool contention (`pg-pool` max 20 connections). PostgreSQL CPU utilization reaches 95% due to high row-level locking checks during extreme bursts. System degrades gracefully returning `409 Conflict` or HTTP 503 rather than corrupted state.

---

## 🚀 Quick Start (Clean Clone Setup)

### Option 1: Docker Compose (Recommended)
```bash
docker compose up --build
```
- **Web UI:** `http://localhost:3000`
- **Backend API:** `http://localhost:4000`
- **Mock Gateway:** `http://localhost:9000`

### Option 2: Run Backend Tests Directly
```bash
cd backend
npm test
```
**Output:** `31 PASSED | 0 FAILED`

---

## 🛠 API Reference & Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Instant health check (< 1ms) |
| `GET` | `/metrics` | System observability (uptime, requests, memory, holds) |
| `GET` | `/movies` | Browse available movies |
| `GET` | `/showtimes?movie_id=` | List showtimes for a movie |
| `GET` | `/seatmap/:showtime_id` | Fetch live seat map for showtime |
| `POST` | `/seats/:seat_id/hold` | Reserve/hold an available seat |
| `POST` | `/otp/send` | Send OTP verification code |
| `POST` | `/otp/verify` | Verify 6-digit OTP code |
| `POST` | `/pay` | Non-blocking payment initiation with `Idempotency-Key` |
| `POST` | `/webhooks/payment` | HMAC-SHA256 signed gateway callback handler |
| `GET` | `/bookings/:booking_ref` | Read-only booking status polling endpoint |

---

## 🏆 Summary of Bonus Accomplishments (+10 Marks)

1. **Fault Isolation:** Stopping the gateway container completely does not break browsing, seat maps, or seat holds. `/health` stays 200 OK.
2. **Observability:** Structured JSON logs with `X-Request-ID` and `/metrics` observability endpoint.
3. **Security:** HMAC-SHA256 signature verification over raw body bytes (`req.rawBody`).
4. **AWS / Poridhi Cloud Deployment:** Containerized setup deployable on AWS EC2 or Poridhi VM.
5. **K6 Load Suite:** Full Scenario A, B, and C k6 test scripts under `k6/`.
