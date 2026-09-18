import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..');

/** Every non-test TypeScript file under src, relative to src, with forward slashes. */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }

    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts')
      ? [relative(SRC, full).split(sep).join('/')]
      : [];
  });
}

const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

/**
 * Whether a file imports the correction entity as a value.
 *
 * A type-only import cannot query anything, so it does not count: the service
 * names the type to shape a response, and that is fine. What matters is the
 * class itself, which is what `find`, `createQueryBuilder` and repositories take.
 */
function importsEntityAsValue(source: string): boolean {
  const imports = source.matchAll(
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'[^']*attendance-correction\.entity'/g,
  );

  return [...imports].some(
    ([, wholeIsType, names]) =>
      wholeIsType === undefined &&
      names
        .split(',')
        .map((name) => name.trim())
        .some(
          (name) => name === 'AttendanceCorrection' || name.startsWith('AttendanceCorrection '),
        ),
  );
}

/**
 * Who may read the correction trail, checked against the source itself.
 *
 * ReadAttendanceCorrectionsAction returns a correction only when the caller may
 * see the record it corrects. Review of BE-AT01 asked that this could not be
 * bypassed by a new endpoint reading the table some other way. The ESLint rule
 * refuses the import; this checks the same thing without depending on lint
 * configuration, and also catches the way lint cannot: raw SQL naming the table.
 */
describe('the attendance correction boundary', () => {
  it('lets only the module and the scoped action import the entity as a value', () => {
    const importers = sourceFiles()
      .filter((file) => importsEntityAsValue(read(file)))
      .sort();

    expect(importers).toEqual([
      'attendance/attendance.module.ts',
      'attendance/read-attendance-corrections.action.ts',
    ]);
  });

  it('names the table in no SQL outside its migrations and its entity', () => {
    const naming = sourceFiles()
      .filter((file) => !file.startsWith('database/migrations/'))
      .filter((file) => /\battendance_corrections\b/.test(read(file)))
      .sort();

    expect(naming).toEqual(['attendance/entities/attendance-correction.entity.ts']);
  });

  it('recognises a value import, so the check above is not vacuous', () => {
    expect(
      importsEntityAsValue(
        "import { AttendanceCorrection } from './entities/attendance-correction.entity';",
      ),
    ).toBe(true);
    expect(
      importsEntityAsValue(
        "import { type AttendanceCorrection } from './entities/attendance-correction.entity';",
      ),
    ).toBe(false);
    expect(
      importsEntityAsValue(
        "import type { AttendanceCorrection } from './entities/attendance-correction.entity';",
      ),
    ).toBe(false);
  });
});
