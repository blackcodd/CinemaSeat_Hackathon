# CinemaSeat - Person 2 Payment & OTP Architecture

## 1. Overview & Architecture

Person 2 is responsible for the asynchronous payment lifecycle, OTP verification, payment gateway integration, webhook signature verification, idempotency management, and race condition resiliency.

```text
Frontend               Express Backend (backend:4000)                Mock Gateway (gateway:9000)
   │                               │                                              │
   │─── 1. POST /pay ─────────────>│                                              │
   │                               │─── 2. POST /charge (Idempotency-Key) ───────>│
   │                               │<── 3. 202 PENDING ───────────────────────────│
   │<── 4. 202/200 PENDING ────────│                                              │
   │                               │                                              │
   │                               │<── 5. POST /webhooks/payment (HMAC Signature)│
   │                               │─── 6. HTTP 200 OK (Always) ─────────────────>│
   │                               │                                              │
   │                               │─── 7. confirmBooking() / failBooking() ──────│
```

---

## 2. API Endpoints

### Payment Initiation (`POST /pay`)
- **URL:** `POST /pay`
- **Request Body:** `{ "booking_ref": "REF-12345", "phone": "+8801700000000" }`
- **Headers:** `Idempotency-Key: payment-REF-12345` (optional control headers: `X-Mock-Mode`, `X-Mock-Force`)
- **Behavior:**
  1. Looks up booking in PostgreSQL and retrieves the authoritative seat price from database (`seats.price`).
  2. Creates initial record in `payments` table with `status = 'PENDING'`.
  3. Sends request to `${GATEWAY_URL}/charge`.
  4. Returns `200/202 PENDING` immediately without waiting for final payment outcome.

### Payment Webhook Callback (`POST /webhooks/payment`)
- **URL:** `POST /webhooks/payment` or `POST /gateway/callback`
- **Headers:** `X-Signature` (HMAC-SHA256 of raw request body using `process.env.GATEWAY_SECRET`)
- **Payload:**
  ```json
  {
    "event_id": "evt_9f2a...",
    "payment_id": "pay_abc123",
    "booking_ref": "REF-12345",
    "status": "SUCCEEDED",
    "amount": 400.00,
    "currency": "BDT",
    "timestamp": "2026-08-08T11:03:22.418Z"
  }
  ```
- **Behavior:**
  1. Validates HMAC signature against raw body bytes. Rejects invalid signatures with HTTP `401 Unauthorized`.
  2. Checks `payments.event_id UNIQUE` constraint. If duplicate event, returns HTTP `200 OK` safely.
  3. For `SUCCEEDED`: invokes Person 1's `confirmBooking(bookingRef, paymentId, eventId, amount)`.
  4. For `FAILED` or `REFUNDED`: invokes Person 1's `failBooking(bookingRef, paymentId, eventId, amount)`.
  5. Always returns HTTP `200 OK` for valid callbacks to satisfy gateway delivery rules.

### OTP Services (`POST /otp/send` & `POST /otp/verify`)
- **`POST /otp/send`**: Sends OTP request to gateway (`${GATEWAY_URL}/otp/send`). Hashes OTP with SHA-256 before storing in `otp_verifications` table. In deterministic mode (`X-Mock-Mode: deterministic`), OTP code is `123456`.
- **`POST /otp/verify`**: Verifies code against gateway (`${GATEWAY_URL}/otp/verify`) and local hashed storage. Rejects after 5 failed attempts (`429 Too Many Requests`).

---

## 3. Reliability, Security & Edge Case Handling

- **HMAC Signature Verification:** Verifies `X-Signature` header over the exact `req.rawBody` buffer using `GATEWAY_SECRET` (default `z2p-2026-secret`).
- **Idempotency Protection:** `Idempotency-Key` prevents double-charging when `/charge` requests are retried.
- **Race Condition Handling (`X-Mock-Force: race`):** Supports early webhook callbacks arriving before `/charge` HTTP response finishes. `confirmBooking()` uses PostgreSQL transactions with `FOR UPDATE` to safely confirm the seat.
- **Timeout Protection (`X-Mock-Force: timeout`):** 30-second outbound HTTP timeout ensures backend Express server does not hang indefinitely.
- **Docker Networking:** Callback URLs use container service names (`http://backend:4000/webhooks/payment`) rather than `localhost`.

---

## 4. Gateway Control Headers for Testing

- `X-Mock-Mode: deterministic`: 2-second delay, always succeeds (`OTP = 123456`).
- `X-Mock-Force: success`: Guaranteed `SUCCEEDED` callback.
- `X-Mock-Force: fail`: Guaranteed `FAILED` callback.
- `X-Mock-Force: duplicate`: Guaranteed duplicate callback delivery (`event_id` reuse).
- `X-Mock-Force: timeout`: Simulates 30-second gateway hang.
- `X-Mock-Force: race`: Callback arrives before `/charge` response returns.
