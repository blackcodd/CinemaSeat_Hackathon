# Architectural Decisions (ADR) — CinemaSeat

This document records the core architectural decisions, options considered, choices made, and trade-offs accepted for CinemaSeat.

---

## 1. Concurrency Arbiter: Redis Distributed Locks (`SET NX EX`) vs PostgreSQL Pessimistic Row Locking (`SELECT FOR UPDATE`)

- **Options Considered:**
  1. **PostgreSQL Row-Level Locking (`SELECT FOR UPDATE`):** Holds row locks inside database transactions. Guarantees safety but serializes all 100 concurrent requests through database connection pools, causing connection pool exhaustion under blockbuster peak loads.
  2. **Redis Distributed Locks (`SET seat:hold:{showtimeId}:{seatId} {bookingRef} NX EX {HOLD_TTL_SECONDS}`):** Redis evaluates lock acquisition in memory in microseconds before any database connection is consumed.
- **What We Chose:** **Redis Distributed Locks (`SET NX EX`)** as the primary concurrency arbiter, paired with a PostgreSQL **Partial Unique Index (`one_active_holder_per_seat`)** as a secondary defense layer.
- **Why:** Redis rejects 99 out of 100 concurrent hold requests in microseconds without opening a DB transaction or consuming a DB connection. This keeps p95 latency under 15ms even during 100+ concurrent bursts.
- **Trade-off:** Requires Redis infrastructure; however, fallback to PostgreSQL transactions guarantees safety if Redis is ever bypassed.

---

## 2. Service Architecture: Split Microservices (`api-service` + `worker-service`) vs Monolith

- **Options Considered:**
  1. **Monolithic Backend:** A single Node.js process serving API endpoints, WebSockets, and processing payment webhooks inline.
  2. **Split Microservices:** `api-service` (Express HTTP + WebSockets) for fast client interaction and webhook ingestion, paired with `worker-service` (Node.js Consumer) for asynchronous state transitions.
- **What We Chose:** **Split Microservices Architecture (`api-service` + `worker-service`)**.
- **Why:** Separating the webhook ingestion layer (`api-service`) from state transition execution (`worker-service`) prevents gateway callback bottlenecks from stalling client browsing or WebSocket broadcasting.
- **Trade-off:** Increases Docker orchestration complexity and requires Redis Queue setup.

---

## 3. Webhook Ingestion Strategy: Asynchronous Redis Queue vs Synchronous Inline Processing

- **Options Considered:**
  1. **Synchronous Inline Processing:** `/webhooks/payment` executes DB transactions, payment validation, and seat state updates before sending HTTP response back to payment gateway.
  2. **Asynchronous Queue Ingestion:** `/webhooks/payment` verifies HMAC signature, deduplicates `event_id` in `processed_webhook_events`, pushes event payload to Redis Queue (`webhook:events`), and ACKs gateway with `200 OK` in < 10ms.
- **What We Chose:** **Asynchronous Queue Ingestion**.
- **Why:** The payment gateway imposes strict callback timeouts and retries on delayed ACKs. Returning `200 OK` in < 10ms eliminates gateway retry storms while ensuring state transitions occur reliably via `worker-service`.
- **Trade-off:** State updates to `bookings` and `seat_status` are eventually consistent, requiring WebSockets or status polling for client UI updates.
