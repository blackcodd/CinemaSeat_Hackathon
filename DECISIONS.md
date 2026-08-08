# Architectural Decisions (ADR) - CinemaSeat

## 1. Seat Concurrency & Locking Strategy
- **Decision:** Included a `version` column in the `seats` table to support Optimistic Concurrency Control (Optimistic Locking) for seat reservations.
- **Rationale:** Prevents race conditions and double booking under high concurrency when multiple users attempt to reserve/hold the same seat at the same time.

## 2. Environment Configuration
- **Decision:** Centralized docker configuration with standard environment variables (`DATABASE_URL`, `HOLD_TTL_SECONDS=60`, `GATEWAY_URL`, `GATEWAY_SECRET=z2p-2026-secret`).

## 3. HMAC-SHA256 Raw Request Body Verification
- **Decision:** Express `express.json` middleware preserves raw HTTP request body bytes (`req.rawBody`). HMAC signature is calculated directly over `req.rawBody` buffer using `GATEWAY_SECRET`.
- **Rationale:** Prevents signature mismatch caused by Express re-serializing parsed JSON properties. Returns HTTP `401 Unauthorized` for invalid signatures.

## 4. Payment Gateway Webhook Delivery & Idempotency
- **Decision:** Webhook callbacks always return HTTP `200 OK` for valid callbacks, utilizing `payments.event_id UNIQUE` constraint to ignore duplicate event deliveries.
- **Rationale:** Prevents the Mock Gateway from triggering exponential backoff retries on duplicate callbacks.

## 5. Asynchronous Payment Return & Race Handling
- **Decision:** `POST /pay` immediately returns `202/200 PENDING` status without blocking. Early webhook callbacks (`X-Mock-Force: race`) confirm seats transactionally via `confirmBooking()`.
