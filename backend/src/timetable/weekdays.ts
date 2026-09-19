/** ISO weekday names, Monday first, so `WEEKDAYS[weekday - 1]` names a period's day. */
const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** The name of an ISO weekday, 1 to 7. The database refuses any other value. */
export function weekdayName(weekday: number): string {
  const name = WEEKDAYS[weekday - 1];

  if (name === undefined) {
    throw new Error(`${weekday} is not an ISO weekday. The database allows 1 to 7 only.`);
  }

  return name;
}
