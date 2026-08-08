'use client';

export default function ShowtimeSelector({ movie, showtimes, loading, error, onBack, onSelectShowtime }) {
  return (
    <section>
      <button className="btn-secondary" style={{ marginBottom: '1.5rem' }} onClick={onBack}>
        ← Back to Movies
      </button>

      <div className="glass-card">
        <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem', fontWeight: 800 }}>
          {movie ? movie.title : 'Movie'} - Select Showtime
        </h2>

        {loading && (
          <div className="alert alert-info">
            <span className="spinner"></span> Fetching available showtimes...
          </div>
        )}

        {error && (
          <div className="alert alert-danger">
            {error}
          </div>
        )}

        {!loading && !error && showtimes.length === 0 && (
          <div className="alert alert-info">No showtimes currently scheduled for this movie.</div>
        )}

        {!loading && showtimes.length > 0 && (
          <div className="showtimes-list">
            {showtimes.map((s) => {
              const dateStr = new Date(s.start_time).toLocaleString();
              const theatreName = s.theatre_id == 1 ? 'Star Cineplex - Bashundhara' : 'Blockbuster Cinemas - Jamuna';

              return (
                <div className="showtime-item" key={s.id}>
                  <div>
                    <strong style={{ fontSize: '1.15rem', color: '#fff' }}>{theatreName}</strong>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                      🕒 {dateStr}
                    </div>
                  </div>
                  <button className="btn-primary" onClick={() => onSelectShowtime(s)}>
                    Select Seats
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
