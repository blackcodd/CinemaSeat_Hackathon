'use client';

export default function Hero({ onBrowse }) {
  return (
    <section className="hero">
      <div className="badge-hero">Zero-Oversell High Concurrency Engine</div>
      <h1>High-Concurrency Cinema Reservations</h1>
      <p>
        Experience zero oversell seat locks, idempotent gateway webhooks, and instant booking confirmations under heavy premiere release traffic.
      </p>
      <button className="btn-primary" onClick={onBrowse}>
        Browse Movies & Select Seats
      </button>
    </section>
  );
}
