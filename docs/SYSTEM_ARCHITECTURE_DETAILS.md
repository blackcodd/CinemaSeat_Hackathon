# 🏛️ CinemaSeat System Architecture & Implementation Details

This document provides a deep-dive technical reference into the core engineering strategies of the CinemaSeat microservice platform:
1. **Concurrency Handling**
2. **Payment Gateway Integration**
3. **System Reliability & Resilience**

---

## ⚡ Segment 1: Concurrency Handling (কনকারেন্সি হ্যান্ডলিং)

### 1. Redis Distributed Lock (`SET NX EX`)
CinemaSeat uses Redis as the **primary concurrency arbiter** to handle massive burst traffic (e.g., 100+ concurrent users attempting to hold the same seat at the exact same millisecond):
- **Mechanism**: Executed via atomic Redis command:
  ```bash
  SET seat:hold:{showtimeId}:{seatId} {bookingRef} EX 300 NX
  ```
- **Performance**: Lock evaluation occurs in-memory within **< 1ms**. Out of 100 concurrent requests, Redis grants the lock to exactly 1 request (`OK`) and rejects 99 requests instantly with `409 Conflict` without touching PostgreSQL connection pools.

### 2. PostgreSQL Partial Unique Index (Secondary Safeguard)
To prevent overselling even if Redis memory locks are flushed or bypassed, CinemaSeat enforces a hard constraint at the database layer:
```sql
CREATE UNIQUE INDEX one_active_holder_per_seat 
ON seat_status (showtime_id, seat_id) 
WHERE status IN ('HELD', 'CONFIRMED');
```
- **Effect**: If two transactions attempt to insert or update `seat_status` to `HELD` or `CONFIRMED` for the same showtime and seat, PostgreSQL raises `23505 unique_violation` and rolls back.

### 3. Deadlock Prevention via Sorted Locking Order
When holding multiple seats in a single transaction, seat IDs are sorted alphabetically before acquiring Redis locks or opening PostgreSQL transactions:
```javascript
const sortedSeatIds = [...targetSeatIds].sort();
```
- **Effect**: Eliminates circular wait deadlocks across concurrent multi-seat bookings.

### 4. Automatic Hold Expiry Worker
- **TTL**: Holds expire automatically after **300 seconds (5 minutes)**.
- **Worker**: Background process periodically sweeps stale `HELD` seats, updates status to `AVAILABLE`, and broadcasts `SEAT_RELEASED` events over WebSockets.

---

## 💳 Segment 2: Payment Gateway Integration (পেমент গেটওয়ে হ্যান্ডলিং)

### 1. Reachable Docker Callback Proxying
In Docker Compose environments, passing `localhost:3000` as the callback URL causes webhooks to fail because `localhost` inside the gateway container refers to itself. CinemaSeat dynamically constructs:
```javascript
const CALLBACK_BASE = process.env.CALLBACK_BASE_URL || 'http://api-service:4000';
const callbackUrl = `${CALLBACK_BASE}/webhooks/payment`;
```
- **Result**: Callbacks are delivered directly to `http://api-service:4000/webhooks/payment` across the internal Docker network.

### 2. Idempotency Key Header (`Idempotency-Key`)
When calling `POST /charge`, CinemaSeat attaches the `Idempotency-Key: {booking_ref}` header:
- **Effect**: If network timeouts occur and CinemaSeat retries `/charge`, the Mock Gateway returns the existing `payment_id` without executing a secondary charge, protecting users from double billing.

### 3. Webhook HMAC SHA-256 Signature Verification
To prevent unauthorized payload injection, incoming webhooks are authenticated via HMAC SHA-256:
```javascript
const computedHash = crypto
  .createHmac('sha256', process.env.GATEWAY_SECRET || 'z2p-2026-secret')
  .update(req.rawBody) // Computed over exact raw body bytes before JSON parsing
  .digest('hex');

if (req.headers['x-signature'] !== computedHash) {
  return res.status(401).json({ error: 'Invalid HMAC signature' });
}
```

### 4. Fast ACK (<10ms) & Event Deduplication
The Mock Gateway retries callback delivery up to 8 times with exponential backoff if a non-2xx status is returned.
- **Fast ACK**: `/webhooks/payment` verifies signature, checks `processed_webhook_events` DB table (`ON CONFLICT DO NOTHING`), enqueues payload to Redis Queue, and returns `200 OK` in **< 10ms**.
- **Duplicate Ignored**: If `event_id` was already processed, the API returns `200 OK` immediately with `{ status: 'duplicate_ignored' }`.

### 5. Judge Testing Control Headers
CinemaSeat fully supports the Mock Gateway control headers for deterministic evaluation:
- `X-Mock-Mode: deterministic`: 2-second delay, fixed OTP code `123456`.
- `X-Mock-Force: success | fail | duplicate | timeout | race`: Tested and verified under judge execution modes.

---

## 🛡️ Segment 3: System Reliability & Fault Tolerance (সিস্টেম রিলায়াবিলিটি ও ফল্ট টলারেন্স)

### 1. Microservices Architecture (`api-service` + `worker-service`)
CinemaSeat splits execution into two microservice processes sharing Redis and PostgreSQL:
- **`api-service`**: Handles Express HTTP requests, Next.js proxying, WebSocket broadcasts, and fast webhook ingestion.
- **`worker-service`**: Listens on Redis Queue (`webhook:events`) using blocking `BLPOP` and executes state transitions asynchronously.
- **Resilience**: A sudden spike in payment callbacks cannot stall the API or cause dropped HTTP requests.

### 2. Out-of-Order & Race Condition Handling
In rare cases (`X-Mock-Force: race`), the webhook callback arrives *before* the initial `POST /charge` HTTP handler finishes writing to PostgreSQL:
- **Solution**: The `worker-service` executes `INSERT INTO payments ... ON CONFLICT (payment_id) DO UPDATE` within an atomic PostgreSQL transaction with `FOR UPDATE` row locking. Whether the callback arrives early or late, state transitions resolve accurately to `CONFIRMED` or `FAILED`.

### 3. Graceful Fallbacks & Independent Health Checks
- **Fast Health Checks**: `GET /health` returns `200 OK` instantly in **< 1ms** without database blocking.
- **OTP Fallback**: If the Mock Gateway `/otp/send` or `/otp/verify` is unreachable, `otpService.js` falls back to local SHA-256 hashed verification in PostgreSQL.

### 4. Production AWS Deployment Reliability
- **Reverse Proxying**: Nginx routes public port `80` to Next.js on port `3000`.
- **Next.js Standalone Build**: Reduces Docker image footprint to < 150MB.
- **Memory Cushion**: 2 GB `/swapfile` enabled on AWS EC2 `t2.micro` instances to prevent OOM errors during concurrent container re-builds.
