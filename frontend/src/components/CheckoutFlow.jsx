'use client';

import { useState, useEffect } from 'react';
import { sendOtp, verifyOtp, executePay, fetchBookingStatus } from '@/lib/api';

export default function CheckoutFlow({
  bookingRef,
  expiresAt,
  seats = [],
  currentUser,
  onSuccess,
  onFailure,
}) {
  const [timeLeft, setTimeLeft] = useState('05:00');
  const [step, setStep] = useState('email'); // 'email' | 'otp' | 'pay' | 'polling'
  const [email, setEmail] = useState(currentUser?.email || 'iftakharalamshihad@gmail.com');
  const [phone, setPhone] = useState(currentUser?.phone || '01700000000');
  const [otp, setOtp] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [alertError, setAlertError] = useState(null);

  const totalPrice = seats.reduce((sum, s) => sum + (Number(s.price) || 400), 0) || 400;
  const seatLabels = seats.map((s) => `${s.row}${s.col}`).join(', ') || 'Selected Seats';

  // 5-Minute (300 Seconds) Hold Countdown Timer
  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expiresAt - now) / 1000));
      const mins = String(Math.floor(diff / 60)).padStart(2, '0');
      const secs = String(diff % 60).padStart(2, '0');
      setTimeLeft(`${mins}:${secs}`);

      if (diff <= 0) {
        clearInterval(interval);
        onFailure('Seat Reservation Expired', 'Your 5-minute hold period expired. The seats have been released for other users.');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onFailure]);

  // Request OTP Code
  const handleSendOtp = async () => {
    if (!email) {
      setAlertError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    setAlertError(null);

    try {
      await sendOtp(bookingRef, phone || email);
      setStep('otp');
    } catch (err) {
      setAlertError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Verify OTP Code
  const handleVerifyOtp = async () => {
    if (!otp) {
      setAlertError('Please enter the 6-digit OTP code.');
      return;
    }
    setLoading(true);
    setAlertError(null);

    try {
      await verifyOtp(bookingRef, otp);
      setStep('pay');
    } catch (err) {
      setAlertError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Execute Payment & Start Webhook Polling
  const handlePayNow = async () => {
    setLoading(true);
    setAlertError(null);

    try {
      await executePay(bookingRef, phone || email, totalPrice);
      setStep('polling');
      startPolling();
    } catch (err) {
      setAlertError(err.message);
      setLoading(false);
    }
  };

  // Status Polling Loop
  const startPolling = () => {
    let attempts = 0;
    const maxAttempts = 30;

    const pollInterval = setInterval(async () => {
      attempts++;
      try {
        const data = await fetchBookingStatus(bookingRef);

        if (data.booking_status === 'CONFIRMED' || data.payment_status === 'SUCCEEDED') {
          clearInterval(pollInterval);
          onSuccess(data.booking_ref, data.payment_id || `pay_${data.booking_ref}`);
          return;
        }

        if (data.booking_status === 'FAILED' || data.booking_status === 'CANCELLED' || data.payment_status === 'FAILED') {
          clearInterval(pollInterval);
          onFailure('Payment Failed', 'Your payment was declined or could not be processed. The seats have been released.');
          return;
        }
      } catch (e) {
        console.warn('Status poll warning:', e);
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        onFailure('Payment Timeout', 'Payment confirmation timed out. If your account was charged, your booking will be confirmed shortly.');
      }
    }, 1000);
  };

  return (
    <section>
      <div className="glass-card" style={{ maxWidth: '560px', margin: '0 auto', textAlign: 'center' }}>
        
        {/* TIMER BADGE */}
        <div className="timer-badge" style={{ marginBottom: '1.5rem' }}>
          ⏱️ Reserved For 5 Mins: <span>{timeLeft}</span>
        </div>

        <h2 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          Complete Your Booking
        </h2>
        <p style={{ color: 'var(--accent-blue)', fontWeight: 700, marginBottom: '0.5rem' }}>
          Seats: {seatLabels} ({seats.length} {seats.length === 1 ? 'Seat' : 'Seats'})
        </p>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Booking Ref: <strong style={{ color: '#fff', fontFamily: 'monospace' }}>{bookingRef}</strong>
        </p>

        {alertError && <div className="alert alert-danger">{alertError}</div>}

        {/* STEP A: EMAIL INPUT */}
        {(step === 'email' || step === 'phone') && (
          <div>
            <div className="form-group">
              <label htmlFor="email">Customer Email Address</label>
              <input
                id="email"
                type="email"
                className="form-control"
                placeholder="iftakharalamshihad@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button
              className="btn-primary"
              style={{ width: '100%' }}
              disabled={loading}
              onClick={handleSendOtp}
            >
              {loading ? <><span className="spinner"></span> Sending OTP...</> : 'Send OTP Code'}
            </button>
          </div>
        )}

        {/* STEP B: OTP VERIFY */}
        {step === 'otp' && (
          <div style={{ marginTop: '1rem' }}>
            <div className="alert alert-info">OTP sent to <strong>{email}</strong>. (Testing Mode: Enter <strong>123456</strong>)</div>
            <div className="form-group">
              <label htmlFor="otp">Enter 6-Digit OTP Code</label>
              <input
                id="otp"
                type="text"
                className="form-control"
                placeholder="123456"
                maxLength={6}
                style={{ textAlign: 'center', letterSpacing: '8px', fontSize: '1.5rem', fontWeight: 800 }}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
              />
            </div>
            <button
              className="btn-primary"
              style={{ width: '100%' }}
              disabled={loading}
              onClick={handleVerifyOtp}
            >
              {loading ? <><span className="spinner"></span> Verifying...</> : 'Verify OTP & Proceed to Pay'}
            </button>
          </div>
        )}

        {/* STEP C: PAYMENT EXECUTION */}
        {step === 'pay' && (
          <div>
            <div className="alert alert-success" style={{ marginBottom: '1.5rem' }}>
              ✓ Email verified successfully via OTP ({email}).
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--card-border)', padding: '1.25rem', borderRadius: '12px', marginBottom: '1.5rem', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Seats ({seats.length}):</span>
                <strong>{seatLabels}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Amount Due:</span>
                <strong style={{ fontSize: '1.25rem', color: 'var(--green-available)' }}>
                  {totalPrice} BDT
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Gateway:</span>
                <span style={{ color: 'var(--accent-blue)' }}>CinemaSeat Gateway</span>
              </div>
            </div>

            <button
              className="btn-primary"
              style={{ width: '100%', fontSize: '1.1rem' }}
              disabled={loading}
              onClick={handlePayNow}
            >
              {loading ? <><span className="spinner"></span> Initiating Payment...</> : `Pay ${totalPrice} BDT Now`}
            </button>
          </div>
        )}

        {/* STEP D: WEBHOOK POLLING */}
        {step === 'polling' && (
          <div style={{ padding: '2rem 0' }}>
            <div className="spinner" style={{ width: '50px', height: '50px', borderWidth: '4px', marginBottom: '1.25rem' }}></div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>Processing Payment...</h3>
            <p style={{ color: 'var(--text-muted)' }}>Communicating with gateway webhook. Please do not close this window.</p>
          </div>
        )}

      </div>
    </section>
  );
}
