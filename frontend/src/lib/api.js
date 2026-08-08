const getApiBase = () => {
  // Always return relative path '' in browser so Next.js rewrites or Nginx proxy transparently forwards requests to api-service:4000
  if (typeof window !== 'undefined') {
    return '';
  }
  return process.env.NEXT_PUBLIC_API_URL || '';
};

export async function loginUser(email, password) {
  const res = await fetch(`${getApiBase()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function fetchDemoUsers() {
  const res = await fetch(`${getApiBase()}/auth/users`);
  if (!res.ok) throw new Error('Failed to fetch demo users');
  return res.json();
}

export async function fetchMovies() {
  const res = await fetch(`${getApiBase()}/movies`);
  if (!res.ok) throw new Error('Failed to fetch movies');
  return res.json();
}

export async function fetchShowtimes(movieId) {
  const res = await fetch(`${getApiBase()}/movies/${movieId}/showtimes`);
  if (!res.ok) throw new Error('Failed to fetch showtimes');
  return res.json();
}

export async function fetchSeatmap(showtimeId) {
  const res = await fetch(`${getApiBase()}/showtimes/${showtimeId}/seats`);
  if (!res.ok) throw new Error('Failed to fetch seatmap');
  return res.json();
}

export async function holdSeat(seatIdOrIds, showtimeId) {
  const seat_ids = Array.isArray(seatIdOrIds) ? seatIdOrIds : [seatIdOrIds];
  const res = await fetch(`${getApiBase()}/bookings/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ showtime_id: showtimeId, seat_ids }),
  });
  if (res.status === 409) {
    const data = await res.json();
    const err = new Error(data.error || 'Seat conflict');
    err.status = 409;
    throw err;
  }
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to hold seat');
  }
  return res.json();
}

export async function sendOtp(bookingRef, phone) {
  const res = await fetch(`${getApiBase()}/bookings/${bookingRef}/otp/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mock-Mode': 'deterministic',
    },
    body: JSON.stringify({ phone }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
  return data;
}

export async function verifyOtp(bookingRef, otp) {
  const res = await fetch(`${getApiBase()}/bookings/${bookingRef}/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Invalid OTP');
  return data;
}

export async function executePay(bookingRef, phone, amount) {
  const res = await fetch(`${getApiBase()}/bookings/${bookingRef}/pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': bookingRef,
    },
    body: JSON.stringify({ phone, amount }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Payment initiation failed');
  return data;
}

export async function fetchBookingStatus(bookingRef) {
  const res = await fetch(`${getApiBase()}/bookings/${bookingRef}`);
  if (!res.ok) throw new Error('Failed to fetch booking status');
  return res.json();
}
