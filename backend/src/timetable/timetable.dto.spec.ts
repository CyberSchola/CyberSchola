import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreatePeriodDto, UpdatePeriodDto } from './timetable.dto';

function messages<T extends object>(type: new () => T, body: object): string[] {
  return validateSync(plainToInstance(type, body)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

const PERIOD = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  weekday: 2,
  label: 'P3',
  startsAt: '09:20',
  endsAt: '10:00',
};

describe('a period', () => {
  it('accepts a weekday, a label and two clock times', () => {
    expect(messages(CreatePeriodDto, PERIOD)).toEqual([]);
  });

  it.each(['00:00', '07:05', '23:59'])('accepts %s', (time) => {
    expect(messages(CreatePeriodDto, { ...PERIOD, startsAt: time })).toEqual([]);
  });

  it.each(['24:00', '8:00', '12:60', '09:20:00', 'noon'])('refuses %s', (time) => {
    expect(messages(CreatePeriodDto, { ...PERIOD, startsAt: time })).toEqual([
      'startsAt must be a time in HH:MM form, 00:00 to 23:59',
    ]);
  });

  it.each([0, 8, 1.5])('refuses weekday %p', (weekday) => {
    expect(messages(CreatePeriodDto, { ...PERIOD, weekday })).not.toEqual([]);
  });

  it('refuses a label longer than the database allows', () => {
    expect(messages(CreatePeriodDto, { ...PERIOD, label: 'x'.repeat(41) })).not.toEqual([]);
  });
});

describe('changing a period', () => {
  it('accepts an empty change, and any one field alone', () => {
    expect(messages(UpdatePeriodDto, {})).toEqual([]);
    expect(messages(UpdatePeriodDto, { label: 'P4' })).toEqual([]);
  });

  it.each(['weekday', 'label', 'startsAt', 'endsAt'])(
    'refuses null for %s, which would clear a required column',
    (field) => {
      expect(messages(UpdatePeriodDto, { [field]: null })).not.toEqual([]);
    },
  );
});
