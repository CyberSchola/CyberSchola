import { weekdayName } from './weekdays';

describe('weekday names', () => {
  it.each([
    [1, 'Monday'],
    [5, 'Friday'],
    [6, 'Saturday'],
    [7, 'Sunday'],
  ])('names ISO weekday %i %s', (weekday, name) => {
    expect(weekdayName(weekday)).toBe(name);
  });

  it.each([0, 8, 2.5])('refuses %p, which the database never stores', (weekday) => {
    expect(() => weekdayName(weekday)).toThrow('is not an ISO weekday');
  });
});
