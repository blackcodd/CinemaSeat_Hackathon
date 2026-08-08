'use client';

export default function FailureView({ title, message, onSelectAnother, onHome }) {
  return (
    <section>
      <div className="glass-card" style={{ maxWidth: '560px', margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>⚠️</div>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--red-confirmed)', marginBottom: '0.5rem' }}>
          {title || 'Reservation Failed'}
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
          {message || 'Your payment failed or seat hold expired.'}
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button className="btn-secondary" onClick={onSelectAnother}>
            Choose Another Seat
          </button>
          <button className="btn-primary" onClick={onHome}>
            Back to Home
          </button>
        </div>
      </div>
    </section>
  );
}
