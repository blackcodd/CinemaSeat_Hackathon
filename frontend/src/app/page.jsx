'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/Header';
import Hero from '@/components/Hero';
import MovieGrid from '@/components/MovieGrid';
import ShowtimeSelector from '@/components/ShowtimeSelector';
import SeatMap from '@/components/SeatMap';
import CheckoutFlow from '@/components/CheckoutFlow';
import TicketPass from '@/components/TicketPass';
import FailureView from '@/components/FailureView';
import LoginModal from '@/components/LoginModal';
import { fetchMovies, fetchShowtimes, fetchSeatmap, holdSeat } from '@/lib/api';

export default function Home() {
  // Navigation View State: 'home' | 'movies' | 'showtimes' | 'seats' | 'checkout' | 'success' | 'failure'
  const [currentView, setCurrentView] = useState('home');

  // User Auth State
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  // Restore logged-in user on mount
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('cinemaseat_user');
      if (savedUser) {
        setCurrentUser(JSON.parse(savedUser));
      }
    } catch (e) {
      console.warn('Could not read user from localStorage', e);
    }
  }, []);

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    try {
      localStorage.setItem('cinemaseat_user', JSON.stringify(user));
    } catch (e) {
      console.warn('Could not save user to localStorage', e);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem('cinemaseat_user');
    } catch (e) {
      console.warn('Could not remove user from localStorage', e);
    }
  };

  // Application Data State
  const [movies, setMovies] = useState([]);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [moviesError, setMoviesError] = useState(null);

  const [selectedMovie, setSelectedMovie] = useState(null);
  const [showtimes, setShowtimes] = useState([]);
  const [showtimesLoading, setShowtimesLoading] = useState(false);
  const [showtimesError, setShowtimesError] = useState(null);

  const [selectedShowtime, setSelectedShowtime] = useState(null);
  const [seats, setSeats] = useState([]);
  const [seatsLoading, setSeatsLoading] = useState(false);
  const [seatConflictError, setSeatConflictError] = useState(false);

  // Multi-seat selection state (Max 10 seats)
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [holdingSeat, setHoldingSeat] = useState(false);
  const [bookingRef, setBookingRef] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [paymentId, setPaymentId] = useState(null);

  const [failureReason, setFailureReason] = useState({ title: '', message: '' });

  // 1. Fetch Movies on View or Init
  const loadMoviesList = async () => {
    setMoviesLoading(true);
    setMoviesError(null);
    try {
      const data = await fetchMovies();
      setMovies(data);
    } catch (err) {
      setMoviesError('Failed to load movies. Ensure backend is running.');
    } finally {
      setMoviesLoading(false);
    }
  };

  useEffect(() => {
    if (currentView === 'movies' && movies.length === 0) {
      loadMoviesList();
    }
  }, [currentView, movies.length]);

  // Handle Movie Selection
  const handleSelectMovie = async (movie) => {
    setSelectedMovie(movie);
    setCurrentView('showtimes');
    setShowtimesLoading(true);
    setShowtimesError(null);
    try {
      const data = await fetchShowtimes(movie.id);
      setShowtimes(data);
    } catch (err) {
      setShowtimesError('Failed to load showtimes.');
    } finally {
      setShowtimesLoading(false);
    }
  };

  // Handle Showtime Selection
  const handleSelectShowtime = async (showtime) => {
    setSelectedShowtime(showtime);
    setSelectedSeats([]);
    setCurrentView('seats');
    setSeatsLoading(true);
    setSeatConflictError(false);
    try {
      const data = await fetchSeatmap(showtime.id);
      setSeats(data);
    } catch (err) {
      console.error('Failed to load seat map:', err);
    } finally {
      setSeatsLoading(false);
    }
  };

  // Toggle seat selection (Add/Remove from array)
  const handleToggleSeat = (seat) => {
    setSelectedSeats((prev) => {
      const exists = prev.some((s) => s.seat_id === seat.seat_id);
      if (exists) {
        return prev.filter((s) => s.seat_id !== seat.seat_id);
      }
      if (prev.length >= 10) return prev;
      return [...prev, seat];
    });
  };

  // Handle Seat Hold Execution for multiple seats
  const handleHoldSeats = async () => {
    if (selectedSeats.length === 0) return;
    setHoldingSeat(true);
    setSeatConflictError(false);

    const seatIds = selectedSeats.map((s) => s.seat_id);

    try {
      const data = await holdSeat(seatIds, selectedShowtime.id);
      setBookingRef(data.booking_ref);
      setExpiresAt(new Date(data.expires_at).getTime());
      setCurrentView('checkout');
    } catch (err) {
      if (err.status === 409) {
        setSeatConflictError(true);
        setSelectedSeats([]);
        // Refresh seat map
        if (selectedShowtime) {
          const freshSeats = await fetchSeatmap(selectedShowtime.id);
          setSeats(freshSeats);
        }
      } else {
        alert(err.message || 'Failed to hold seats.');
      }
    } finally {
      setHoldingSeat(false);
    }
  };

  // Handle Successful Booking
  const handleBookingSuccess = (ref, payId) => {
    setBookingRef(ref);
    setPaymentId(payId);
    setCurrentView('success');
  };

  // Handle Failed Booking
  const handleBookingFailure = (title, message) => {
    setFailureReason({ title, message });
    setCurrentView('failure');
  };

  return (
    <div>
      <Header
        currentView={currentView}
        currentUser={currentUser}
        onOpenLogin={() => setIsLoginOpen(true)}
        onLogout={handleLogout}
        onNavigate={(view) => {
          setCurrentView(view);
          if (view === 'movies') loadMoviesList();
        }}
      />

      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />

      <main>
        {currentView === 'home' && (
          <Hero onBrowse={() => {
            setCurrentView('movies');
            loadMoviesList();
          }} />
        )}

        {currentView === 'movies' && (
          <MovieGrid
            movies={movies}
            loading={moviesLoading}
            error={moviesError}
            onSelectMovie={handleSelectMovie}
          />
        )}

        {currentView === 'showtimes' && (
          <ShowtimeSelector
            movie={selectedMovie}
            showtimes={showtimes}
            loading={showtimesLoading}
            error={showtimesError}
            onBack={() => setCurrentView('movies')}
            onSelectShowtime={handleSelectShowtime}
          />
        )}

        {currentView === 'seats' && (
          <SeatMap
            seats={seats}
            selectedSeats={selectedSeats}
            loading={seatsLoading}
            conflictError={seatConflictError}
            holdingSeat={holdingSeat}
            onBack={() => setCurrentView('showtimes')}
            onToggleSeat={handleToggleSeat}
            onHoldSeats={handleHoldSeats}
          />
        )}

        {currentView === 'checkout' && (
          <CheckoutFlow
            bookingRef={bookingRef}
            expiresAt={expiresAt}
            seats={selectedSeats}
            currentUser={currentUser}
            onSuccess={handleBookingSuccess}
            onFailure={handleBookingFailure}
          />
        )}

        {currentView === 'success' && (
          <TicketPass
            bookingRef={bookingRef}
            paymentId={paymentId}
            movie={selectedMovie}
            onHome={() => setCurrentView('home')}
          />
        )}

        {currentView === 'failure' && (
          <FailureView
            title={failureReason.title}
            message={failureReason.message}
            onSelectAnother={() => setCurrentView('movies')}
            onHome={() => setCurrentView('home')}
          />
        )}
      </main>
    </div>
  );
}
