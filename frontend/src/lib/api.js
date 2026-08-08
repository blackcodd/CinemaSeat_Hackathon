const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:4000';
    }
    return `http://${hostname}:4000`;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
};

async function apiFetch(path, options = {}) {
  const primaryUrl = `${getApiBase()}${path}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(primaryUrl, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    if (typeof window !== 'undefined') {
      // Fallback to relative path (handled by Nginx / same origin proxy)
      return fetch(path, options);
    }
    throw err;
  }
}

export async function loginUser(email, password) {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function fetchDemoUsers() {
  const res = await apiFetch('/auth/users');
  if (!res.ok) throw new Error('Failed to fetch demo users');
  return res.json();
}

export async function fetchMovies() {
  const res = await apiFetch('/movies');
  if (!res.ok) throw new Error('Failed to fetch movies');
  return res.json();
}

export async function fetchShowtimes(movieId) {
  const res = await apiFetch(`/movies/${movieId}/showtimes`);
  if (!res.ok) throw new Error('Failed to fetch showtimes');
  return res.json();
}

export async function fetchSeatmap(showtimeId) {
  const res = await apiFetch(`/showtimes/${showtimeId}/seats`);
  if (!res.ok) throw new Error('Failed to fetch seatmap');
  return res.json();
}

export async function holdSeat(seatIdOrIds, showtimeId) {
  const seat_ids = Array.isArray(seatIdOrIds) ? seatIdOrIds : [seatIdOrIds];
  const res = await apiFetch('/bookings/hold', {
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
  const res = await apiFetch(`/bookings/${bookingRef}/otp/send`, {
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
  const res = await apiFetch(`/bookings/${bookingRef}/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Invalid OTP');
  return data;
}

export async function executePay(bookingRef, phone, amount) {
  const res = await apiFetch(`/bookings/${bookingRef}/pay`, {
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
  const res = await apiFetch(`/bookings/${bookingRef}`);
  if (!res.ok) throw new Error('Failed to fetch booking status');
  return res.json();
}
