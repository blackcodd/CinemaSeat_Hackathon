# Architectural Decisions (ADR) - CinemaSeat

## 1. Seat Concurrency & Locking Strategy
- **Decision:** Included a `version` column in the `seats` table to support Optimistic Concurrency Control (Optimistic Locking) for seat reservations.
- **Rationale:** Prevents race conditions and double booking under high concurrency when multiple users attempt to reserve/hold the same seat at the same time.

## 2. Environment Configuration
- **Decision:** Centralized docker configuration with standard environment variables (`DATABASE_URL`, `HOLD_TTL_SECONDS=60`, `GATEWAY_URL`).
