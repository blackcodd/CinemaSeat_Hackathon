# CinemaSeat - K6 Load Testing & Concurrency Suite

This directory contains k6 load scripts for testing high-concurrency seat hold reservations and read performance under load.

---

## 🛠 Prerequisites

Install k6:
- **macOS:** `brew install k6`
- **Linux (Ubuntu/Debian):** `sudo apt-get install k6`
- **Docker:** `docker run --rm -i grafana/k6 run - < k6/seat-hold.js`

---

## 🚀 Running Tests

### 1. 100 Concurrent Virtual Users Seat Hold Test (Zero Oversell Verification)
This test simulates 100 virtual users attempting to hold the exact same seat at the exact same millisecond:

```bash
k6 run k6/seat-hold.js
```

**Expected Result:**
- `successful_holds`: **1**
- `conflicted_holds`: **99**
- `failed_holds`: **0**
- **Oversell count:** **0**

### 2. Read Endpoints Load Test
Simulates ramping load (10 → 25 → 50 VUs) across `GET /movies`, `GET /showtimes`, and `GET /seatmap/1`:

```bash
k6 run k6/read-apis.js
```
