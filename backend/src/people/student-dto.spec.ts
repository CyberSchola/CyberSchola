import { Student } from './entities/student.entity';
import { toStudentDto } from './people.service';

function student(): Student {
  return Object.assign(new Student(), {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    tenantId: '11111111-2222-4333-8444-555555555555',
    membershipId: '22222222-3333-4444-8555-666666666666',
    firstName: 'Amaka',
    lastName: 'Okafor',
    otherNames: 'Chiamaka',
    dateOfBirth: '2014-03-09',
    admissionNumber: 'GFC/2026/014',
  });
}

describe('toStudentDto', () => {
  it('gives a summary only the name, with no personal fields present at all', () => {
    // Absent, not null. A client must not be able to tell from a null whether a
    // student has a date of birth on record.
    const dto = toStudentDto({ student: student(), view: 'summary' });

    expect(dto).toEqual({
      id: student().id,
      firstName: 'Amaka',
      lastName: 'Okafor',
      view: 'summary',
    });
    for (const field of ['otherNames', 'dateOfBirth', 'admissionNumber', 'membershipId']) {
      expect(dto).not.toHaveProperty(field);
    }
  });

  it('gives a profile everything the API exposes, and nothing internal', () => {
    const dto = toStudentDto({ student: student(), view: 'profile' });

    expect(Object.keys(dto).sort()).toEqual(
      [
        'id',
        'firstName',
        'lastName',
        'view',
        'otherNames',
        'dateOfBirth',
        'admissionNumber',
        'membershipId',
      ].sort(),
    );
    expect(dto).not.toHaveProperty('tenantId');
  });
});
