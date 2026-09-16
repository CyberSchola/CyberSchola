import type { EntityManager } from 'typeorm';

import type { AccessScope } from '../common/actions/access-scope';
import { TenantScopedAction } from '../common/actions/tenant-scoped.action';
import type { Page, PageRequest } from '../common/pagination/pagination';
import { Student } from './entities/student.entity';
import { studentAccessScope } from './teacher-access.scope';

/**
 * The students this caller may see.
 *
 * For an administrator, the whole school. For a teacher, the students blueprint
 * sections 13 and 14 allow: those in a class they supervise this session, or
 * taking a subject they teach. The rule lives in `teacher-access.scope.ts`, and
 * this action is only the first thing to compose it.
 */
export class ListStudentsAction extends TenantScopedAction<Student> {
  protected readonly accessScope: AccessScope<Student> = studentAccessScope();

  constructor(manager: EntityManager) {
    super(manager, Student);
  }

  /**
   * One page, and the total under the same scope.
   *
   * The count comes from the same scoped query as the rows. A teacher who could
   * see five students but was told the school has four hundred would learn
   * something the scope exists to withhold.
   */
  async execute(page: PageRequest): Promise<Page<Student>> {
    const [items, total] = await this.scopedQuery('student')
      .orderBy('student.createdAt', 'ASC')
      .addOrderBy('student.id', 'ASC')
      .take(page.limit)
      .skip(page.offset)
      .getManyAndCount();

    return { items, total, limit: page.limit, offset: page.offset };
  }
}
