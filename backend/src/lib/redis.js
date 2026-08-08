const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

const pubClient = new Redis(redisUrl);
const subClient = new Redis(redisUrl);

redis.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

/**
 * Acquire distributed lock for seat hold
 * Key: seat:hold:{showtimeId}:{seatId}
 * EX: HOLD_TTL_SECONDS
 * NX: Only set if key does not exist
 */
async function tryAcquireSeatHold(showtimeId, seatId, bookingRef, ttlSeconds = 300) {
  const key = `seat:hold:${showtimeId}:${seatId}`;
  // Returns 'OK' if lock acquired, null if key already exists
  const result = await redis.set(key, bookingRef, 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

/**
 * Explicitly release a seat hold from Redis
 */
async function releaseSeatHold(showtimeId, seatId) {
  const key = `seat:hold:${showtimeId}:${seatId}`;
  await redis.del(key);
}

/**
 * Push validated webhook payload to Redis Queue
 */
async function enqueueWebhookEvent(eventData) {
  await redis.rpush('webhook:events', JSON.stringify(eventData));
}

/**
 * Pop webhook event payload from Redis Queue (blocking read)
 */
async function dequeueWebhookEvent(timeoutSeconds = 0) {
  const res = await redis.blpop('webhook:events', timeoutSeconds);
  if (!res) return null;
  const [_, payload] = res;
  return JSON.parse(payload);
}

/**
 * Publish seat map update event over Redis Pub/Sub
 */
async function publishSeatUpdate(showtimeId, updateData) {
  const channel = `showtime:${showtimeId}:seats`;
  await pubClient.publish(channel, JSON.stringify(updateData));
}

module.exports = {
  redis,
  pubClient,
  subClient,
  tryAcquireSeatHold,
  releaseSeatHold,
  enqueueWebhookEvent,
  dequeueWebhookEvent,
  publishSeatUpdate,
};
