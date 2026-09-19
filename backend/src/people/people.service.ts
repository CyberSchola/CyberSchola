import { Injectable } from '@nestjs/common';
import type { DeepPartial, EntityManager } from 'typeorm';

import { RecordAction } from '../common/actions/record.action';
import type { TenantOwnedEntity } from '../common/entities/tenant-owned.entity';
import {
  ResourceConflictException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../common/exceptions/app.exception';
import type { Page, PageRequest } from '../common/pagination/pagination';
import { Membership, MembershipStatus } from '../identity/membership.entity';
import { requireTenantId, requireUserId } from '../tenancy/request-context';
import { TenantTransactionService } from '../tenancy/tenant-transaction.service';
import { Guardianship, GuardianRelationship } from './entities/guardianship.entity';
import { Parent } from './entities/parent.entity';
import { SchoolAdmin } from './entities/school-admin.entity';
import { Staff } from './entities/staff.entity';
import { Student } from './entities/student.entity';
import { Teacher } from './entities/teacher.entity';
import { ListStudentsAction, type VisibleStudent } from './list-students.action';
import type {
  CreateGuardianshipDto,
  GuardianshipDto,
  ParentDto,
  SchoolAdminDto,
  StaffDto,
  StudentDto,
  TeacherDto,
} from './people.dto';

/**
 * Why a suspended membership cannot be given a role. Shared with the routes' documentation.
 *
 * Membership status is authoritative: a role row describes what a person is in the
 * school, and status says whether that membership may be used at all. Granting a
 * role to a suspended one would create a participant that looks current attached
 * to a person the school has switched off. The database refuses it too, through a
 * trigger on every role table; this check is what turns that into a readable 422.
 */
export const ROLE_REQUIRES_ACTIVE_MEMBERSHIP =
  'That membership is suspended. Reactivate it before giving it a role in this school.';

/** Why the last administrator cannot be removed. Shared with the route's documentation. */
export const LAST_ADMINISTRATOR_MESSAGE =
  'A school must keep at least one administrator. Add another before removing this one.';

/** A person record that can be linked to a login. */
type LinkableRecord = TenantOwnedEntity & { membershipId: string | null };

/**
 * One kind of person, as the service needs to know it.
 *
 * The registry below is what keeps four person types to one implementation of
 * create, update, remove and account linking. A rule fixed here, such as how a
 * link is checked, is fixed for all of them at once.
 */
interface PersonKind<TEntity extends LinkableRecord, TDto> {
  readonly entity: new () => TEntity;
  readonly alias: string;
  readonly toDto: (row: TEntity) => TDto;
}

export const PERSON_KINDS = {
  student: {
    entity: Student,
    alias: 'student',
    // Only administrators reach the write routes, so writes answer with the profile.
    toDto: (row: Student): StudentDto => toStudentDto({ student: row, view: 'profile' }),
  } satisfies PersonKind<Student, StudentDto>,
  teacher: {
    entity: Teacher,
    alias: 'teacher',
    toDto: (row: Teacher): TeacherDto => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      membershipId: row.membershipId,
    }),
  } satisfies PersonKind<Teacher, TeacherDto>,
  parent: {
    entity: Parent,
    alias: 'parent',
    toDto: (row: Parent): ParentDto => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      membershipId: row.membershipId,
    }),
  } satisfies PersonKind<Parent, ParentDto>,
  staff: {
    entity: Staff,
    alias: 'staff',
    toDto: (row: Staff): StaffDto => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      jobTitle: row.jobTitle,
      membershipId: row.membershipId,
    }),
  } satisfies PersonKind<Staff, StaffDto>,
} as const;

/**
 * The people of a school: records, account links, administrators and guardianship.
 *
 * Every operation runs with both the user and the school in session, so
 * row-level security confines it to one school. Every write route is gated on
 * `people.manage`, which only an administrator holds; which *students* a caller
 * may read is the student access scope's job.
 *
 * Constraint violations propagate to the exception filter: a duplicate admission
 * number or an already-linked membership is 409, and a guardianship naming a
 * parent or student outside this school is 404, because the composite foreign
 * key cannot find it.
 */
@Injectable()
export class PeopleService {
  constructor(private readonly transactions: TenantTransactionService) {}

  // -------------------------------------------------------------------------
  // Students, scoped
  // -------------------------------------------------------------------------

  /** The students this caller may see, each shaped to what they may see of it. */
  listStudents(page: PageRequest): Promise<Page<StudentDto>> {
    return this.inSchool(async (manager) => {
      const result = await new ListStudentsAction(manager).execute(page);

      return { ...result, items: result.items.map(toStudentDto) };
    });
  }

  /**
   * One student, or 404.
   *
   * 404 rather than 403 for a student the caller may not see, including a parent
   * asking about somebody else's child: whether a student exists is itself
   * information, and the answer must not differ from an id that was never issued.
   */
  getStudent(id: string): Promise<StudentDto> {
    return this.inSchool(async (manager) => {
      const found = await new ListStudentsAction(manager).findVisible(id);

      if (!found) {
        throw new ResourceNotFoundException();
      }

      return toStudentDto(found);
    });
  }

  // -------------------------------------------------------------------------
  // Records, for every person kind
  // -------------------------------------------------------------------------

  list<TEntity extends LinkableRecord, TDto>(
    kind: PersonKind<TEntity, TDto>,
    page: PageRequest,
  ): Promise<Page<TDto>> {
    return this.inSchool(async (manager) => {
      const result = await this.records(manager, kind).list(page);

      return { ...result, items: result.items.map(kind.toDto) };
    });
  }

  create<TEntity extends LinkableRecord, TDto>(
    kind: PersonKind<TEntity, TDto>,
    input: DeepPartial<TEntity>,
  ): Promise<TDto> {
    return this.inSchool(async (manager) => {
      // A record is created without a login. Linking is a separate, explicit
      // step, so a membership id in a create payload cannot grant a role.
      const created = await this.records(manager, kind).create({
        ...input,
        membershipId: null,
      });

      return kind.toDto(created);
    });
  }

  update<TEntity extends LinkableRecord, TDto>(
    kind: PersonKind<TEntity, TDto>,
    id: string,
    changes: DeepPartial<TEntity>,
  ): Promise<TDto> {
    return this.inSchool(async (manager) => {
      // The link is not editable through an update, for the same reason as above.
      const { membershipId: _ignored, ...allowed } = changes as DeepPartial<LinkableRecord>;
      const updated = await this.records(manager, kind).update(id, allowed as DeepPartial<TEntity>);

      if (!updated) {
        throw new ResourceNotFoundException();
      }

      return kind.toDto(updated);
    });
  }

  remove<TEntity extends LinkableRecord, TDto>(
    kind: PersonKind<TEntity, TDto>,
    id: string,
  ): Promise<void> {
    return this.inSchool(async (manager) => {
      if (!(await this.records(manager, kind).softRemove(id))) {
        throw new ResourceNotFoundException();
      }
    });
  }

  /**
   * Links a login to a record, which gives that login the record's role.
   *
   * The membership is looked up under row-level security, so one belonging to
   * another school is not found and the answer is 404. A membership already
   * linked to a live record of this kind violates the one-per-membership index
   * and the answer is 409. Replacing an existing link on this record is allowed:
   * it is how a mistaken link is corrected. A suspended membership is refused:
   * linking is granting a role, and a role is only granted to an active member.
   */
  linkAccount<TEntity extends LinkableRecord, TDto>(
    kind: PersonKind<TEntity, TDto>,
    id: string,
    membershipId: string,
  ): Promise<TDto> {
    return this.inSchool(async (manager) => {
      const records = this.records(manager, kind);
      const record = await records.findById(id);
      const membership = await manager.findOne(Membership, { where: { id: membershipId } });

      if (!record || !membership) {
        throw new ResourceNotFoundException();
      }

      assertActive(membership);

      record.membershipId = membership.id;

      return kind.toDto(await manager.save(record));
    });
  }

  /** Removes a record's login link, and with it that login's role. */
  unlinkAccount<TEntity extends LinkableRecord, TDto>(
    kind: PersonKind<TEntity, TDto>,
    id: string,
  ): Promise<TDto> {
    return this.inSchool(async (manager) => {
      const record = await this.records(manager, kind).findById(id);

      if (!record) {
        throw new ResourceNotFoundException();
      }

      record.membershipId = null;

      return kind.toDto(await manager.save(record));
    });
  }

  // -------------------------------------------------------------------------
  // Administrators
  // -------------------------------------------------------------------------

  listAdmins(page: PageRequest): Promise<Page<SchoolAdminDto>> {
    return this.inSchool(async (manager) => {
      const result = await new RecordAction(manager, SchoolAdmin, 'admin').list(page);

      return { ...result, items: result.items.map(toAdminDto) };
    });
  }

  /**
   * Makes a member of this school an administrator.
   *
   * Live, then active, then granted. A removed membership is hidden from the
   * lookup by its delete column, so it is a 404 like an id never issued; a
   * suspended one exists and is refused with a 422 saying so.
   */
  addAdmin(membershipId: string): Promise<SchoolAdminDto> {
    return this.inSchool(async (manager) => {
      const membership = await manager.findOne(Membership, { where: { id: membershipId } });

      if (!membership) {
        throw new ResourceNotFoundException();
      }

      assertActive(membership);

      const created = await new RecordAction(manager, SchoolAdmin, 'admin').create({
        membershipId: membership.id,
      });

      return toAdminDto(created);
    });
  }

  /**
   * Removes an administrator, unless they are the last one.
   *
   * A school with no administrator cannot add one back: nobody would hold
   * `people.manage`. So the last live administrator cannot be removed, and the
   * check has to hold under concurrency. Two administrators removing each other at
   * the same moment would each count two and each succeed, leaving none. Locking
   * every live administrator row first makes the second transaction wait for the
   * first and then count one.
   */
  removeAdmin(id: string): Promise<void> {
    return this.inSchool(async (manager) => {
      const live = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM school_admins WHERE tenant_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [requireTenantId()],
      );

      if (!live.some((row) => row.id === id)) {
        throw new ResourceNotFoundException();
      }

      if (live.length === 1) {
        throw new ResourceConflictException(LAST_ADMINISTRATOR_MESSAGE);
      }

      await new RecordAction(manager, SchoolAdmin, 'admin').softRemove(id);
    });
  }

  // -------------------------------------------------------------------------
  // Guardianship
  // -------------------------------------------------------------------------

  listGuardianships(page: PageRequest, studentId?: string): Promise<Page<GuardianshipDto>> {
    return this.inSchool(async (manager) => {
      const query = manager
        .createQueryBuilder(Guardianship, 'guardianship')
        .where('guardianship.tenantId = :tenantId', { tenantId: requireTenantId() })
        .orderBy('guardianship.createdAt', 'ASC')
        .addOrderBy('guardianship.id', 'ASC')
        .take(page.limit)
        .skip(page.offset);

      if (studentId !== undefined) {
        query.andWhere('guardianship.studentId = :studentId', { studentId });
      }

      const [items, total] = await query.getManyAndCount();

      return { items: items.map(toGuardianshipDto), total, limit: page.limit, offset: page.offset };
    });
  }

  /** Links a parent to a child. Both must be in this school, or 404. */
  addGuardianship(input: CreateGuardianshipDto): Promise<GuardianshipDto> {
    return this.inSchool(async (manager) => {
      const created = await new RecordAction(manager, Guardianship, 'guardianship').create({
        parentId: input.parentId,
        studentId: input.studentId,
        relationship: input.relationship ?? GuardianRelationship.Guardian,
      });

      return toGuardianshipDto(created);
    });
  }

  /** Unlinks a parent from a child, which ends that parent's access at once. */
  removeGuardianship(id: string): Promise<void> {
    return this.inSchool(async (manager) => {
      if (!(await new RecordAction(manager, Guardianship, 'guardianship').softRemove(id))) {
        throw new ResourceNotFoundException();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private inSchool<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.transactions.runInUserAndTenantContext(requireUserId(), requireTenantId(), work);
  }

  private records<TEntity extends LinkableRecord, TDto>(
    manager: EntityManager,
    kind: PersonKind<TEntity, TDto>,
  ): RecordAction<TEntity> {
    return new RecordAction(manager, kind.entity, kind.alias);
  }
}

// ---------------------------------------------------------------------------
// Row to response.
// ---------------------------------------------------------------------------

/**
 * A student in the shape this caller may see.
 *
 * The summary is built first and the profile fields added only for `profile`, so
 * a mistake here omits data rather than leaking it.
 */
export function toStudentDto({ student, view }: VisibleStudent): StudentDto {
  const summary: StudentDto = {
    id: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    view,
  };

  if (view === 'summary') {
    return summary;
  }

  return {
    ...summary,
    otherNames: student.otherNames,
    dateOfBirth: student.dateOfBirth,
    admissionNumber: student.admissionNumber,
    membershipId: student.membershipId,
  };
}

const toAdminDto = (row: SchoolAdmin): SchoolAdminDto => ({
  id: row.id,
  membershipId: row.membershipId,
});

const toGuardianshipDto = (row: Guardianship): GuardianshipDto => ({
  id: row.id,
  parentId: row.parentId,
  studentId: row.studentId,
  relationship: row.relationship,
});

/**
 * Refuses a membership that may not be given a role.
 *
 * Only status is checked here. A removed membership never reaches this point,
 * because the entity's delete column hides it from the lookup that precedes it.
 */
function assertActive(membership: Membership): void {
  if (membership.status !== MembershipStatus.Active) {
    throw new ValidationFailedException([ROLE_REQUIRES_ACTIVE_MEMBERSHIP]);
  }
}
