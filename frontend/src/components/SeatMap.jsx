'use client';

import { useState } from 'react';

export default function SeatMap({
  seats,
  selectedSeats = [],
  loading,
  conflictError,
  holdingSeat,
  onBack,
  onToggleSeat,
  onHoldSeats,
}) {
  const [maxSeatAlert, setMaxSeatAlert] = useState(null);

  const handleSeatClick = (seat) => {
    const isAlreadySelected = selectedSeats.some((s) => s.seat_id === seat.seat_id);
    if (!isAlreadySelected && selectedSeats.length >= 10) {
      setMaxSeatAlert('You can select a maximum of 10 seats at a time.');
      setTimeout(() => setMaxSeatAlert(null), 4000);
      return;
    }
    setMaxSeatAlert(null);
    onToggleSeat(seat);
  };

  const totalPrice = selectedSeats.reduce((sum, s) => sum + (Number(s.price) || 400), 0);

  return (
    <section>
      <button className="btn-secondary" style={{ marginBottom: '1.5rem' }} onClick={onBack}>
        ← Back to Showtimes
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '2rem' }} className="responsive-layout">
        
        {/* SEATMAP VISUALIZER */}
        <div className="glass-card seatmap-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 800 }}>Select Seats</h2>
            <div className="badge-hero" style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-blue)', margin: 0 }}>
              Selected: {selectedSeats.length} / 10 Max
            </div>
          </div>

          <div className="curved-screen">
            <span className="curved-screen-text">CINEMA SCREEN</span>
          </div>

          <div className="legend">
            <div className="legend-item"><div className="legend-box legend-available"></div> Available</div>
            <div className="legend-item"><div className="legend-box legend-selected"></div> Selected</div>
            <div className="legend-item"><div className="legend-box legend-held"></div> Held</div>
            <div className="legend-item"><div className="legend-box legend-confirmed"></div> Confirmed</div>
          </div>

          {maxSeatAlert && (
            <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
              ⚠️ {maxSeatAlert}
            </div>
          )}

          {loading && (
            <div className="alert alert-info">
              <span className="spinner"></span> Loading seat map...
            </div>
          )}

          {conflictError && (
            <div className="alert alert-danger">
              Sorry, one or more selected seats were just taken! Refreshing seat map...
            </div>
          )}

          {!loading && (
            <div className="seats-grid">
              {seats.map((s) => {
                const isSelected = selectedSeats.some((sel) => sel.seat_id === s.seat_id);
                const statusClass = isSelected ? 'SELECTED' : s.status;
                const isDisabled = s.status === 'HELD' || s.status === 'CONFIRMED';
                const ariaLabel = `Seat ${s.row}${s.col}, status ${s.status}, price ${s.price} BDT`;

                return (
                  <button
                    key={s.seat_id}
                    className={`seat-btn ${statusClass}`}
                    disabled={isDisabled}
                    aria-label={ariaLabel}
                    onClick={() => handleSeatClick(s)}
                  >
                    {s.row}{s.col}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* SIDEBAR SUMMARY */}
        <div className="glass-card" style={{ height: 'fit-content' }}>
          <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.75rem', fontWeight: 800 }}>
            Reservation Summary
          </h3>

          {selectedSeats.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2.5rem 0' }}>
              Click up to 10 available seats to begin reservation.
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Selected Seats ({selectedSeats.length}):</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {selectedSeats.map((s) => (
                    <span
                      key={s.seat_id}
                      style={{
                        background: 'var(--blue-gradient)',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        color: '#fff',
                      }}
                    >
                      Seat {s.row}{s.col}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', borderTop: '1px dashed var(--card-border)', paddingTop: '0.75rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Amount:</span>
                <strong style={{ fontSize: '1.2rem', color: 'var(--green-available)' }}>{totalPrice} BDT</strong>
              </div>

              <button
                className="btn-primary"
                style={{ width: '100%', fontSize: '1.05rem' }}
                disabled={holdingSeat}
                onClick={onHoldSeats}
              >
                {holdingSeat ? (
                  <>
                    <span className="spinner"></span> Reserving {selectedSeats.length} {selectedSeats.length === 1 ? 'Seat' : 'Seats'}...
                  </>
                ) : (
                  `Hold ${selectedSeats.length} ${selectedSeats.length === 1 ? 'Seat' : 'Seats'} Now`
                )}
              </button>
            </div>
          )}
        </div>

      </div>
    </section>
  );
}
