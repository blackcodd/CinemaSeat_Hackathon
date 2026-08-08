# CinemaSeat - API Contract

This document outlines the locked API contract for the CinemaSeat project.

## Endpoints

### 1. Get Movies
- **Method:** `GET`
- **Endpoint:** `/movies`
- **Response:** `[{ "id": 1, "title": "Movie Title", "poster_url": "https://..." }]`

### 2. Get Showtimes
- **Method:** `GET`
- **Endpoint:** `/showtimes?movie_id=:movieId`
- **Response:** `[{ "id": 1, "movie_id": 1, "theatre_id": 1, "start_time": "2026-08-08T18:00:00Z" }]`

### 3. Get Seatmap
- **Method:** `GET`
- **Endpoint:** `/seatmap/:showtime_id`
- **Response:** `[{ "seat_id": 1, "row": "A", "col": 1, "status": "AVAILABLE", "price": 500 }]`

### 4. Hold Seat
- **Method:** `POST`
- **Endpoint:** `/seats/:seat_id/hold`
- **Response:** `{ "hold_id": "uuid-string", "expires_at": "2026-08-08T18:01:00Z", "booking_ref": "REF123456" }`

### 5. Process Payment
- **Method:** `POST`
- **Endpoint:** `/pay`
- **Response:** `{ "payment_id": "pay_98765", "status": "PENDING" }`

### 6. Payment Gateway Callback
- **Method:** `POST`
- **Endpoint:** `/gateway/callback`
- **Response:** HTTP `200 OK` (always)

### 7. Send OTP
- **Method:** `POST`
- **Endpoint:** `/otp/send`
- **Response:** `{ "status": "sent" }`

### 8. Verify OTP
- **Method:** `POST`
- **Endpoint:** `/otp/verify`
- **Response:** `{ "verified": true }`

### 9. Health Check
- **Method:** `GET`
- **Endpoint:** `/health`
- **Response:** `{ "status": "ok" }`
