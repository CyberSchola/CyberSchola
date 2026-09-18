import { absentDayIndexes, DEMO_STUDENTS, DEMO_SUBJECTS, demoTermSchoolDays } from './demo-dataset';

describe('the hackathon demo dataset', () => {
  it('gives the demo term exactly 100 school days, so every attendance figure is exact', () => {
    const days = demoTermSchoolDays();

    expect(days).toHaveLength(100);
    expect(days[0]).toBe('2026-01-05');
    expect(days.at(-1)).toBe('2026-05-22');
    expect(days.every((day) => ![0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()))).toBe(
      true,
    );
  });

  it.each(DEMO_STUDENTS.filter((student) => student.attendancePercent !== null))(
    'gives $firstName $lastName a register that is exactly $attendancePercent% present',
    ({ attendancePercent }) => {
      const absent = absentDayIndexes(attendancePercent!, 100);

      expect(100 - absent.size).toBe(attendancePercent);
      expect([...absent].every((index) => index >= 0 && index < 100)).toBe(true);
    },
  );

  it('keeps the roll of twelve, with Esther Williams enrolled but without figures', () => {
    expect(DEMO_STUDENTS).toHaveLength(12);
    expect(
      DEMO_STUDENTS.find((student) => student.firstName === 'Esther')?.attendancePercent,
    ).toBeNull();
  });

  it('has five subjects, each with its own teacher', () => {
    expect(DEMO_SUBJECTS.map((subject) => subject.code)).toEqual([
      'MTH',
      'ENG',
      'PHY',
      'CHE',
      'BIO',
    ]);
    expect(
      new Set(DEMO_SUBJECTS.map((s) => `${s.teacher.firstName} ${s.teacher.lastName}`)).size,
    ).toBe(5);
  });
});
