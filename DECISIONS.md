# Architectural Decisions (ADR) - CinemaSeat

This document records the major architectural decisions considered and implemented during the development of CinemaSeat under high-concurrency conditions.

---

## 1. Concurrency & Locking Strategy for Seat Holds

- **Options Considered:**
  1. **Application-level In-Memory Locks (Node.js Mutex / Redis lock):** Fastest in single-node scenarios, but fails across multiple load-balanced backend containers and adds Redis complexity.
  2. **Pessimistic Row-Level Locking (`SELECT FOR UPDATE` in PostgreSQL):** Locks the specific seat database row inside a database transaction until committed or rolled back.
  3. **Optimistic Locking (`version` column checking):** Requires retries when conflicts occur.
- **What We Chose:** Pessimistic Row-Level Locking (`SELECT FOR UPDATE`) combined with database transaction bounds.
- **Why:** Guarantees absolute zero-oversell under extreme concurrent spikes (e.g., 100 requests hitting seat #1 in the exact same millisecond). PostgreSQL manages row locks reliably across distributed API instances.
- **What We Gave Up:** Database connections hold short locks during transaction processing, slightly reducing peak throughput compared to non-transactional writes, but guaranteeing 100% data correctness.

---

## 2. Payment Gateway Webhook Delivery & Idempotency Strategy

- **Options Considered:**
  1. **Synchronous Payment Processing:** Backend `/pay` handler blocks until the gateway finishes callback processing.
  2. **Asynchronous Non-blocking Processing with Database Deduplication:** `/pay` returns `202/200 PENDING` immediately. Gateway callbacks are processed asynchronously by `/webhooks/payment`, returning HTTP `200 OK` always and deduplicating via `payments.event_id UNIQUE` constraint.
- **What We Chose:** Asynchronous Non-blocking Processing with `payments.event_id UNIQUE` deduplication and immediate HTTP `200 OK` return.
- **Why:** The Mock Gateway specifies that non-200 responses trigger infinite retries, and network delays or duplicate callbacks (8% rate) must not cause duplicate payments or double-confirmed bookings.
- **What We Gave Up:** The client receives a `PENDING` status on initial payment submit and must poll or wait for final confirmation via `/bookings/:booking_ref`.

---

## 3. Webhook Security & HMAC-SHA256 Raw Body Signature Verification

- **Options Considered:**
  1. **Re-stringifying parsed JSON body (`JSON.stringify(req.body)`):** Simple, but key order variations or whitespace formatting differences produce different hashes, breaking HMAC verification.
  2. **Express `req.rawBody` Buffer Capture:** Capturing the raw HTTP request bytes directly in Express middleware during JSON body parsing.
- **What We Chose:** Express `req.rawBody` Buffer Capture with HMAC-SHA256 signature verification using `GATEWAY_SECRET`.
- **Why:** Guarantees cryptographic accuracy of HMAC signature verification regardless of JSON body parsing quirks or key reordering.
- **What We Gave Up:** Requires capturing raw buffer bytes in custom Express middleware before `express.json()` processes request bodies.

---

## 4. Fault Isolation & Independent Health Check Strategy

- **Options Considered:**
  1. **Dependent Health Check:** `/health` pings database and gateway before returning 200 OK.
  2. **Isolated Independent Health Check:** `/health` responds immediately with HTTP `200 OK` from memory without invoking external network requests.
- **What We Chose:** Isolated Independent Health Check returning `{"status": "ok"}` in < 1ms.
- **Why:** Health monitoring tools and orchestrators must verify local backend container availability even if external gateway services experience downtime or rate limiting.
- **What We Gave Up:** `/health` does not reflect external gateway connectivity state, but preserves backend availability during third-party service outages.
