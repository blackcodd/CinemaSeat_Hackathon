'use client';

export default function Header({ currentView, onNavigate, currentUser, onOpenLogin, onLogout }) {
  return (
    <header>
      <div className="brand" onClick={() => onNavigate('home')} style={{ cursor: 'pointer' }}>
        <div className="brand-icon">🎬</div>
        <div>
          Cinema<span className="brand-span">Seat</span>
        </div>
      </div>

      <nav style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          className={currentView === 'home' ? 'active' : ''}
          onClick={() => onNavigate('home')}
        >
          Home
        </button>
        <button
          className={currentView === 'movies' ? 'active' : ''}
          onClick={() => onNavigate('movies')}
        >
          Movies
        </button>

        {currentUser ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span
              style={{
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid var(--accent-blue)',
                padding: '0.35rem 0.75rem',
                borderRadius: '20px',
                fontSize: '0.85rem',
                fontWeight: 700,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              👤 {currentUser.name}
            </span>
            <button
              onClick={onLogout}
              className="btn-secondary"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
            >
              Logout
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenLogin}
            className="btn-primary"
            style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
          >
            🔑 Login
          </button>
        )}
      </nav>
    </header>
  );
}
