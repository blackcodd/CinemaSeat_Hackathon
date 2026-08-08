# CinemaSeat - System Architecture

## 🏛 Overall System Architecture

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

---

## 🔄 Core Sequences & Lifecycles

### 1. Seat Reservation Sequence (Person 1)
```text
Browser                     Backend API                    PostgreSQL DB
   │                             │                              │
   │─── 1. POST /seats/1/hold ──>│                              │
   │                             │─── 2. BEGIN TRANSACTION ────>│
   │                             │─── 3. SELECT FOR UPDATE ────>│ (Row lock seat #1)
   │                             │─── 4. Check status AVAILABLE ─>│
   │                             │─── 5. UPDATE status HELD ───>│
   │                             │─── 6. COMMIT TRANSACTION ───>│
   │<── 7. 200 OK (booking_ref)──│                              │
```

### 2. Payment & Callback Sequence (Person 2)
```text
Browser                 Backend API               Mock Gateway             PostgreSQL DB
   │                         │                          │                        │
   │── 1. POST /pay ────────>│                          │                        │
   │                         │── 2. Query seat price ──>│                        │
   │                         │── 3. Insert PENDING ────>│                        │
   │                         │── 4. POST /charge ──────>│                        │
   │                         │<─ 5. 202 PENDING ────────│                        │
   │<─ 6. 202 PENDING ───────│                          │                        │
   │                         │                          │                        │
   │                         │<─ 7. Callback (Webhook) ─│                        │
   │                         │── 8. HMAC Verify ────────│                        │
   │                         │── 9. Deduplicate Event ──│                        │
   │                         │── 10. confirmBooking() ─────────────────────────>│
   │                         │── 11. 200 OK ───────────>│                        │
```

### 3. User Frontend Journey (Person 3)
```text
[ Home ] ──> [ Select Movie ] ──> [ Select Showtime ] ──> [ Interactive Seatmap ]
                                                                   │
                                                                   v
[ Booking Confirmation ] <── [ Status Polling ] <── [ Pay ] <── [ OTP Verify ] <── [ Hold Seat ]
```
