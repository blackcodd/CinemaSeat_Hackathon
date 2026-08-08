import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5s', target: 10 },
    { duration: '10s', target: 25 },
    { duration: '10s', target: 50 },
    { duration: '5s', target: 0 },
  ],
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';

export default function () {
  const moviesRes = http.get(`${BASE_URL}/movies`);
  check(moviesRes, { 'GET /movies status 200': (r) => r.status === 200 });

  const showtimesRes = http.get(`${BASE_URL}/showtimes?movie_id=1`);
  check(showtimesRes, { 'GET /showtimes status 200': (r) => r.status === 200 });

  const seatmapRes = http.get(`${BASE_URL}/seatmap/1`);
  check(seatmapRes, { 'GET /seatmap/1 status 200': (r) => r.status === 200 });

  sleep(1);
}
