import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

export const successfulHolds = new Counter('successful_holds');
export const conflictedHolds = new Counter('conflicted_holds');
export const failedHolds = new Counter('failed_holds');

export const options = {
  scenarios: {
    concurrent_seat_hold: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 1,
      maxDuration: '30s',
    },
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';
const TARGET_SEAT_ID = __ENV.SEAT_ID || 1;

export default function () {
  const url = `${BASE_URL}/seats/${TARGET_SEAT_ID}/hold`;
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(url, null, params);

  check(res, {
    'Status is 200 or 409': (r) => r.status === 200 || r.status === 409,
  });

  if (res.status === 200) {
    successfulHolds.add(1);
  } else if (res.status === 409) {
    conflictedHolds.add(1);
  } else {
    failedHolds.add(1);
  }
}
