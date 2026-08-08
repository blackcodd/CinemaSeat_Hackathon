const { processHoldExpiry } = require('./bookingService');

let intervalId = null;

function startExpiryWorker(intervalMs = 2000) {
  if (intervalId) return;

  intervalId = setInterval(async () => {
    try {
      await processHoldExpiry();
    } catch (err) {
      console.error('Expiry worker error:', err);
    }
  }, intervalMs);

  console.log(`Seat hold expiry worker started (checking every ${intervalMs}ms)`);
}

function stopExpiryWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = {
  startExpiryWorker,
  stopExpiryWorker,
};
