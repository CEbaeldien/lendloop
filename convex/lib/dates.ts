// Loan dates are calendar days (YYYY-MM-DD) in UTC. Comparing them as
// strings is safe because the format sorts lexicographically.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function todayUtc(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function isValidDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Two inclusive date ranges overlap. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && bStart <= aEnd;
}
