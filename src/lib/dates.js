const VALID_INTERVALS = new Set([
  '1m', '2m', '5m', '15m', '30m', '60m', '90m',
  '1h', '1d', '5d', '1wk', '1mo', '3mo',
]);

export { VALID_INTERVALS };

export function validateInterval(interval) {
  if (!interval) return undefined;
  if (!VALID_INTERVALS.has(interval)) {
    throw new Error(
      `Invalid interval "${interval}". Valid intervals: ${[...VALID_INTERVALS].join(', ')}`,
    );
  }
  return interval;
}

export function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function resolveDateRange({ from, to, lookbackDays = 180 }) {
  const end = to ? new Date(to) : new Date();
  const start = from
    ? new Date(from)
    : new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid from/to date supplied. Use ISO strings like 2026-03-01.');
  }

  if (start > end) {
    throw new Error('The from date must be earlier than the to date.');
  }

  return {
    from: isoDate(start),
    to: isoDate(end),
  };
}

export function inferInterval({ from, to, requestedInterval }) {
  if (requestedInterval) return validateInterval(requestedInterval);
  const start = new Date(from);
  const end = new Date(to);
  const days = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 10) return '1h';
  if (days <= 60) return '1d';
  return '1wk';
}
