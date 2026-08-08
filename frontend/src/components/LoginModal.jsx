'use client';

import { useState } from 'react';
import { loginUser } from '@/lib/api';

export default function LoginModal({ isOpen, onClose, onLoginSuccess }) {
  const [email, setEmail] = useState('zayan@example.com');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await loginUser(email, password);
      onLoginSuccess(data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (demoEmail, demoPassword) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setLoading(true);
    setError(null);

    try {
      const data = await loginUser(demoEmail, demoPassword);
      onLoginSuccess(data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem',
    }}>
      <div className="glass-card" style={{ maxWidth: '440px', width: '100%', position: 'relative' }}>
        
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1.25rem',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '1.5rem',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>

        <h2 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '0.25rem', color: '#fff' }}>
          Account Login
        </h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Log in to manage bookings and auto-fill checkout
        </p>

        {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

        {/* Quick Demo User Buttons */}
        <div style={{ marginBottom: '1.5rem', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--card-border)', padding: '1rem', borderRadius: '12px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-blue)', display: 'block', marginBottom: '0.75rem' }}>
            ⚡ One-Click Quick Demo Login:
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.85rem' }}
              onClick={() => handleQuickLogin('zayan@example.com', 'password123')}
            >
              👤 <strong>Zayan Ahmed</strong> (zayan@example.com)
            </button>

            <button
              type="button"
              className="btn-secondary"
              style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.85rem' }}
              onClick={() => handleQuickLogin('cuet.student@example.com', 'password123')}
            >
              🎓 <strong>CUET Student</strong> (cuet.student@example.com)
            </button>

            <button
              type="button"
              className="btn-secondary"
              style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.85rem' }}
              onClick={() => handleQuickLogin('admin@cinemaseat.com', 'admin123')}
            >
              👑 <strong>CinemaSeat Admin</strong> (admin@cinemaseat.com)
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              type="email"
              className="form-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              className="form-control"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', marginTop: '0.5rem' }}
            disabled={loading}
          >
            {loading ? <><span className="spinner"></span> Logging in...</> : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}
