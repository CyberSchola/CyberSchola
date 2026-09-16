import type { EntityManager, SelectQueryBuilder } from 'typeorm';

import { Role } from '../auth/permission.matrix';
import type { AccessScope } from '../common/actions/access-scope';
import { TenantScopedAction } from '../common/actions/tenant-scoped.action';
import type { Page, PageRequest } from '../common/pagination/pagination';
import { Student } from './entities/student.entity';
import { parentOfStudent, studentIsSelf, studentScope } from './student-access.scope';

/** How much of a student record a caller receives. */
export type StudentView = 'summary' | 'profile';

/** The relationship flags selected beside each row. */
interface ViewFlags {
  is_self: boolean;
  is_linked_child: boolean;
}

/** A student as this caller may see it. */
export interface VisibleStudent {
  readonly student: Student;
  readonly view: StudentView;
}

/**
 * Reading students, scoped to the caller and shaped per row.
 *
 * Two separate questions, answered in one query:
 *
 * 1. **Which students.** The access scope: every student for an administrator,
 *    the teacher rule for a teacher, linked children for a parent, themselves for
 *    a student, and the union for a person holding several roles.
 * 2. **How much of each.** A teacher needs a name to teach; a date of birth and
 *    an admission number are for the school, the student and their family. So
 *    the full profile goes to an administrator, to the student themselves, and to
 *    a linked parent, and everyone else gets the summary.
 *
 * The second question is per row, not per caller: a teacher who is also a parent
 * gets the profile for their own child and the summary for their pupils in the
 * same page. It is computed as two selected flags beside each row, so a
 * page costs one query rather than one extra query per student.
 */
export class ListStudentsAction extends TenantScopedAction<Student> {
  constructor(manager: EntityManager) {
    super(manager, Student);
  }

  protected readonly accessScope: AccessScope<Student> = studentScope<Student>('id');

  /** One page, with the total under the same scope. */
  async execute(page: PageRequest): Promise<Page<VisibleStudent>> {
    const query = this.scopedQuery('student')
      .orderBy('student.lastName', 'ASC')
      .addOrderBy('student.firstName', 'ASC')
      .addOrderBy('student.id', 'ASC');

    // The count comes from the scoped builder before the flags are added, so the
    // total cannot disagree with the rows it describes.
    const total = await query.getCount();

    const rows = await this.withViewFlags(query)
      .limit(page.limit)
      .offset(page.offset)
      .getRawAndEntities<ViewFlags>();

    return {
      items: this.shape(rows.entities, rows.raw),
      total,
      limit: page.limit,
      offset: page.offset,
    };
  }

  /** One student, or null when it does not exist or this caller may not see it. */
  async findVisible(id: string): Promise<VisibleStudent | null> {
    const query = this.withViewFlags(
      this.scopedQuery('student').andWhere('student.id = :__studentId', { __studentId: id }),
    );

    const rows = await query.getRawAndEntities<ViewFlags>();

    return this.shape(rows.entities, rows.raw)[0] ?? null;
  }

  /**
   * Adds the per-row relationship flags.
   *
   * `limit`/`offset` rather than `take`/`skip` above, deliberately: with no joins
   * the raw rows and the entities line up one to one, and `take`/`skip` would run
   * a second query to paginate by distinct id for no benefit.
   */
  private withViewFlags(query: SelectQueryBuilder<Student>): SelectQueryBuilder<Student> {
    const self = studentIsSelf('student.id', this.actor);
    const child = parentOfStudent('student.id', this.actor);

    return query
      .addSelect(self.sql, 'is_self')
      .addSelect(child.sql, 'is_linked_child')
      .setParameters({ ...self.params, ...child.params });
  }

  private shape(students: Student[], raw: ViewFlags[]): VisibleStudent[] {
    const administrator = this.actor.roles.has(Role.SchoolAdmin);

    return students.map((student, index) => {
      const flags = raw[index];
      const personal = administrator || flags?.is_self === true || flags?.is_linked_child === true;

      return { student, view: personal ? 'profile' : 'summary' };
    });
  }
}
