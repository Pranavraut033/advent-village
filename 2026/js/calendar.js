// How many doors are open. `dayParam` is the ?day= preview override (digits only), else the local date decides.
export function openedDoors(now, dayParam) {
  if (typeof dayParam === 'string' && /^\d+$/.test(dayParam)) return Math.min(24, Math.max(0, parseInt(dayParam, 10)));
  const year = now.getFullYear();
  if (year < 2026) return 0;
  if (year > 2026) return 24;
  if (now.getMonth() < 11) return 0;
  return Math.min(now.getDate(), 24);
}
