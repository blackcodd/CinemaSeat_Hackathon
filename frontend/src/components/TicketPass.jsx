'use client';

export default function TicketPass({ bookingRef, paymentId, movie, onHome }) {
  return (
    <section>
      <div className="glass-card" style={{ maxWidth: '580px', margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: '4rem', marginBottom: '0.5rem' }}>🎟️</div>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 900, color: 'var(--green-available)', marginBottom: '0.5rem' }}>
          Booking Confirmed!
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
          Your ticket pass is ready. Present this pass at the theatre entrance.
        </p>

        <div className="ticket-pass" style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
            <div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff' }}>
                {movie ? movie.title : 'CinemaSeat Ticket'}
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Star Cineplex • Hall 1</p>
            </div>
            <div className="ticket-qr">
              <svg width="78" height="78" viewBox="0 0 24 24" fill="none" stroke="#0f172a" strokeWidth="2">
                <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h-3zM18 18h3v3h-3zM15 18h3v3h-3z"/>
              </svg>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', borderTop: '1px dashed rgba(255,255,255,0.15)', paddingTop: '1rem' }}>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block' }}>Booking Ref:</span>
              <strong style={{ color: 'var(--accent-blue)', fontFamily: 'monospace', fontSize: '1rem' }}>
                {bookingRef}
              </strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block' }}>Payment ID:</span>
              <strong style={{ fontFamily: 'monospace', fontSize: '0.95rem' }}>
                {paymentId}
              </strong>
            </div>
          </div>
        </div>

        <button className="btn-primary" onClick={onHome}>
          Book Another Ticket
        </button>
      </div>
    </section>
  );
}
