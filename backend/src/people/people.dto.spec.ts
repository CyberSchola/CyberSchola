import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateParentDto, UpdateTeacherDto } from './people.dto';

/** The constraint messages for one property, flattened. */
function messagesFor<T extends object>(
  type: new () => T,
  body: object,
  property: string,
): string[] {
  return validateSync(plainToInstance(type, body))
    .filter((error) => error.property === property)
    .flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('person names', () => {
  it('refuses null on update with one message that says what a name must be', () => {
    // Clearing a required name must be a 400, never a NOT NULL violation from the
    // database, and the caller should not be told a null is too long.
    expect(messagesFor(UpdateTeacherDto, { firstName: null }, 'firstName')).toEqual([
      'firstName must be a name of 1 to 100 characters, not blank',
    ]);
  });

  it.each([
    ['blank', '   '],
    ['empty', ''],
    ['too long', 'x'.repeat(101)],
    ['not a string', 42],
  ])('refuses a %s name', (_label, value) => {
    expect(
      messagesFor(CreateParentDto, { firstName: value, lastName: 'Okafor' }, 'firstName'),
    ).toHaveLength(1);
  });

  it('accepts a real name, including one at the length limit', () => {
    expect(
      messagesFor(CreateParentDto, { firstName: 'Ngozi', lastName: 'Okafor' }, 'firstName'),
    ).toEqual([]);
    expect(
      messagesFor(CreateParentDto, { firstName: 'x'.repeat(100), lastName: 'Okafor' }, 'firstName'),
    ).toEqual([]);
  });

  it('lets an update leave a name out entirely', () => {
    expect(messagesFor(UpdateTeacherDto, {}, 'firstName')).toEqual([]);
  });

  it('requires a name on create', () => {
    expect(messagesFor(CreateParentDto, { lastName: 'Okafor' }, 'firstName')).toHaveLength(1);
  });
});
