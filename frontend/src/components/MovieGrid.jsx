'use client';

const posterArtMap = {
  '1': 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=600&auto=format&fit=crop&q=80',
  '2': 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=600&auto=format&fit=crop&q=80',
  '3': 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80'
};

export default function MovieGrid({ movies, loading, error, onSelectMovie }) {
  if (loading) {
    return (
      <div className="alert alert-info">
        <span className="spinner"></span> Loading movies from server...
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-danger">
        {error}
      </div>
    );
  }

  return (
    <section>
      <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 800 }}>Now Showing</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Select a blockbuster movie to browse showtimes</p>
      
      <div className="movies-grid">
        {movies.map((m) => {
          const posterSrc = (m.poster_url && m.poster_url.startsWith('http'))
            ? m.poster_url
            : (posterArtMap[String(m.id)] || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&auto=format&fit=crop&q=80');

          return (
            <div className="movie-card" key={m.id}>
              <div className="movie-poster-wrap">
                <span className="movie-badge-premiere">Premiere</span>
                <img className="movie-poster" src={posterSrc} alt={m.title} loading="lazy" />
              </div>
              <div className="movie-info">
                <div>
                  <div className="movie-title">{m.title}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                    2D / 3D • IMAX • Premiere
                  </div>
                </div>
                <button
                  className="btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => onSelectMovie(m)}
                >
                  View Showtimes
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
