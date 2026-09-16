import { Injectable } from '@nestjs/common';
import type { DeepPartial, EntityManager } from 'typeorm';

import { Role } from '../auth/permission.matrix';
import {
  ResourceNotFoundException,
  ValidationFailedException,
} from '../common/exceptions/app.exception';
import type { TenantOwnedEntity } from '../common/entities/tenant-owned.entity';
import type { Page, PageRequest } from '../common/pagination/pagination';
import { Membership } from '../identity/membership.entity';
import { requireTenantId, requireUserId } from '../tenancy/request-context';
import { TenantTransactionService } from '../tenancy/tenant-transaction.service';
import type {
  AcademicSessionDto,
  ClassDto,
  ClassEnrolmentDto,
  ClassSubjectDto,
  ClassSupervisorDto,
  CreateAcademicSessionDto,
  CreateClassDto,
  CreateClassEnrolmentDto,
  CreateClassSubjectDto,
  CreateClassSupervisorDto,
  CreateElectiveRegistrationDto,
  CreateGradeLevelDto,
  CreateSubjectDto,
  CreateTermDto,
  ElectiveRegistrationDto,
  GradeLevelDto,
  PersonAnchorDto,
  SubjectDto,
  TermDto,
} from './academics.dto';
import { AcademicSession } from './entities/academic-session.entity';
import { ClassEnrolment } from './entities/class-enrolment.entity';
import { ClassSubject } from './entities/class-subject.entity';
import { ClassSupervisor } from './entities/class-supervisor.entity';
import { ElectiveRegistration } from './entities/elective-registration.entity';
import { GradeLevel } from './entities/grade-level.entity';
import { SchoolClass } from './entities/school-class.entity';
import { Student } from './entities/student.entity';
import { Subject } from './entities/subject.entity';
import { Teacher } from './entities/teacher.entity';
import { Term } from './entities/term.entity';
import { ListStudentsAction } from './list-students.action';
import { RecordAction } from './record.action';

/**
 * The academic spine: structure, assignments, and the students a caller may see.
 *
 * Every operation runs with both the user and the school in session, so
 * row-level security confines it to one school and the access scopes narrow
 * from there. Constraint violations are left to propagate: the exception filter
 * turns a duplicate or an overlap into 409, a reference outside this school into
 * 404, and a date that does not fit into 422, the same way for every resource.
 */
@Injectable()
export class AcademicsService {
  constructor(private readonly transactions: TenantTransactionService) {}

  // -------------------------------------------------------------------------
  // Structure
  // -------------------------------------------------------------------------

  listSessions(page: PageRequest): Promise<Page<AcademicSessionDto>> {
    return this.listOf(AcademicSession, 'session', page, toSessionDto);
  }

  createSession(input: CreateAcademicSessionDto): Promise<AcademicSessionDto> {
    return this.createOf(AcademicSession, 'session', input, toSessionDto);
  }

  /**
   * Makes one session the school's current session.
   *
   * Two statements in one transaction, in this order on purpose. The partial
   * unique index allows one current session per school, so setting the new flag
   * before clearing the old one would briefly hold two and be rejected. Clearing
   * first, then setting, stays within the rule at every step.
   *
   * Everything a teacher can reach follows the current session, so this is the
   * switch that moves every teacher's access to the new year at once.
   */
  setCurrentSession(sessionId: string): Promise<AcademicSessionDto> {
    return this.inSchool(async (manager) => {
      const target = await manager.findOne(AcademicSession, { where: { id: sessionId } });

      if (!target) {
        throw new ResourceNotFoundException();
      }

      await manager.update(AcademicSession, { isCurrent: true }, { isCurrent: false });
      await manager.update(AcademicSession, { id: sessionId }, { isCurrent: true });

      return toSessionDto({ ...target, isCurrent: true });
    });
  }

  listTerms(page: PageRequest): Promise<Page<TermDto>> {
    return this.listOf(Term, 'term', page, toTermDto);
  }

  createTerm(input: CreateTermDto): Promise<TermDto> {
    return this.createOf(Term, 'term', input, toTermDto);
  }

  listGradeLevels(page: PageRequest): Promise<Page<GradeLevelDto>> {
    return this.listOf(GradeLevel, 'grade', page, toGradeLevelDto);
  }

  createGradeLevel(input: CreateGradeLevelDto): Promise<GradeLevelDto> {
    return this.createOf(GradeLevel, 'grade', input, toGradeLevelDto);
  }

  listClasses(page: PageRequest): Promise<Page<ClassDto>> {
    return this.listOf(SchoolClass, 'schoolClass', page, toClassDto);
  }

  createClass(input: CreateClassDto): Promise<ClassDto> {
    return this.createOf(SchoolClass, 'schoolClass', input, toClassDto);
  }

  listSubjects(page: PageRequest): Promise<Page<SubjectDto>> {
    return this.listOf(Subject, 'subject', page, toSubjectDto);
  }

  createSubject(input: CreateSubjectDto): Promise<SubjectDto> {
    return this.createOf(Subject, 'subject', { ...input, code: input.code ?? null }, toSubjectDto);
  }

  // -------------------------------------------------------------------------
  // People anchors
  // -------------------------------------------------------------------------

  createStudent(membershipId: string): Promise<PersonAnchorDto> {
    return this.createAnchor(Student, 'student', membershipId, Role.Student);
  }

  createTeacher(membershipId: string): Promise<PersonAnchorDto> {
    return this.createAnchor(Teacher, 'teacher', membershipId, Role.Teacher);
  }

  // -------------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------------

  createClassSupervisor(input: CreateClassSupervisorDto): Promise<ClassSupervisorDto> {
    return this.createOf(ClassSupervisor, 'supervisor', input, toSupervisorDto);
  }

  createClassSubject(input: CreateClassSubjectDto): Promise<ClassSubjectDto> {
    return this.createOf(
      ClassSubject,
      'classSubject',
      { ...input, isElective: input.isElective ?? false },
      toClassSubjectDto,
    );
  }

  /**
   * Enrols a student, taking the session from the class.
   *
   * The caller names a class and a student, never a session. Looking the class
   * up under row-level security also means a class belonging to another school
   * is simply not found, which is the 404 decision 6A calls for.
   */
  createEnrolment(input: CreateClassEnrolmentDto): Promise<ClassEnrolmentDto> {
    return this.inSchool(async (manager) => {
      const schoolClass = await manager.findOne(SchoolClass, { where: { id: input.classId } });

      if (!schoolClass) {
        throw new ResourceNotFoundException();
      }

      const enrolment = await new RecordAction(manager, ClassEnrolment, 'enrolment').create({
        classId: schoolClass.id,
        sessionId: schoolClass.sessionId,
        studentId: input.studentId,
      });

      return toEnrolmentDto(enrolment);
    });
  }

  /**
   * Registers a student for an elective.
   *
   * Two checks the schema cannot express. The subject must actually be an
   * elective: a registration for a core subject is meaningless, since everyone in
   * the class already takes it. And the student must be enrolled in that
   * subject's class: a registration for an elective in a different class grants
   * no access anyway, because the teacher rule joins through the student's own
   * enrolment, but storing it would leave data that says something false.
   */
  createElectiveRegistration(
    input: CreateElectiveRegistrationDto,
  ): Promise<ElectiveRegistrationDto> {
    return this.inSchool(async (manager) => {
      const classSubject = await manager.findOne(ClassSubject, {
        where: { id: input.classSubjectId },
      });

      if (!classSubject) {
        throw new ResourceNotFoundException();
      }

      if (!classSubject.isElective) {
        throw new ValidationFailedException([
          'classSubjectId names a core subject. Every student enrolled in the class already ' +
            'takes it, so only electives take registrations.',
        ]);
      }

      const enrolled = await manager.findOne(ClassEnrolment, {
        where: { classId: classSubject.classId, studentId: input.studentId },
      });

      if (!enrolled) {
        throw new ValidationFailedException([
          'The student is not enrolled in the class this elective is taught in.',
        ]);
      }

      const registration = await new RecordAction(
        manager,
        ElectiveRegistration,
        'registration',
      ).create({ classSubjectId: classSubject.id, studentId: input.studentId });

      return toRegistrationDto(registration);
    });
  }

  // -------------------------------------------------------------------------
  // Students, scoped
  // -------------------------------------------------------------------------

  /** The students this caller may see: all for an administrator, a teacher's own otherwise. */
  listStudents(page: PageRequest): Promise<Page<PersonAnchorDto>> {
    return this.inSchool(async (manager) => {
      const result = await new ListStudentsAction(manager).execute(page);

      return { ...result, items: result.items.map(toAnchorDto) };
    });
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private inSchool<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.transactions.runInUserAndTenantContext(requireUserId(), requireTenantId(), work);
  }

  private listOf<TEntity extends TenantOwnedEntity, TDto>(
    entity: new () => TEntity,
    alias: string,
    page: PageRequest,
    toDto: (row: TEntity) => TDto,
  ): Promise<Page<TDto>> {
    return this.inSchool(async (manager) => {
      const result = await new RecordAction(manager, entity, alias).list(page);

      return { ...result, items: result.items.map(toDto) };
    });
  }

  private createOf<TEntity extends TenantOwnedEntity, TDto>(
    entity: new () => TEntity,
    alias: string,
    input: DeepPartial<TEntity>,
    toDto: (row: TEntity) => TDto,
  ): Promise<TDto> {
    return this.inSchool(async (manager) => {
      const created = await new RecordAction(manager, entity, alias).create(input);

      return toDto(created);
    });
  }

  /**
   * Anchors a membership as a student or a teacher, after checking its role.
   *
   * The role is checked here rather than by a foreign key on purpose. BE-A01
   * allows one role per membership, so a teacher who is also a parent cannot be
   * both, and that is scheduled to change in the people phase. A role-locked key
   * would bake the single-role model into the schema; this check does not.
   */
  private createAnchor<TEntity extends Student | Teacher>(
    entity: new () => TEntity,
    alias: string,
    membershipId: string,
    expected: Role,
  ): Promise<PersonAnchorDto> {
    return this.inSchool(async (manager) => {
      const membership = await manager.findOne(Membership, { where: { id: membershipId } });

      if (!membership) {
        throw new ResourceNotFoundException();
      }

      if (membership.role !== expected) {
        throw new ValidationFailedException([
          `That membership holds the ${membership.role} role, not ${expected}.`,
        ]);
      }

      const created = await new RecordAction(manager, entity, alias).create({
        membershipId,
      } as DeepPartial<TEntity>);

      return toAnchorDto(created);
    });
  }
}

// ---------------------------------------------------------------------------
// Row to response. Only the fields a caller needs, never the entity itself.
// ---------------------------------------------------------------------------

const toSessionDto = (row: AcademicSession): AcademicSessionDto => ({
  id: row.id,
  name: row.name,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  isCurrent: row.isCurrent,
});

const toTermDto = (row: Term): TermDto => ({
  id: row.id,
  sessionId: row.sessionId,
  name: row.name,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
});

const toGradeLevelDto = (row: GradeLevel): GradeLevelDto => ({
  id: row.id,
  name: row.name,
  position: row.position,
});

const toClassDto = (row: SchoolClass): ClassDto => ({
  id: row.id,
  sessionId: row.sessionId,
  gradeLevelId: row.gradeLevelId,
  arm: row.arm,
});

const toSubjectDto = (row: Subject): SubjectDto => ({
  id: row.id,
  name: row.name,
  code: row.code,
});

const toAnchorDto = (row: Student | Teacher): PersonAnchorDto => ({
  id: row.id,
  membershipId: row.membershipId,
});

const toSupervisorDto = (row: ClassSupervisor): ClassSupervisorDto => ({
  id: row.id,
  classId: row.classId,
  teacherId: row.teacherId,
});

const toClassSubjectDto = (row: ClassSubject): ClassSubjectDto => ({
  id: row.id,
  classId: row.classId,
  subjectId: row.subjectId,
  teacherId: row.teacherId,
  isElective: row.isElective,
});

const toEnrolmentDto = (row: ClassEnrolment): ClassEnrolmentDto => ({
  id: row.id,
  classId: row.classId,
  sessionId: row.sessionId,
  studentId: row.studentId,
});

const toRegistrationDto = (row: ElectiveRegistration): ElectiveRegistrationDto => ({
  id: row.id,
  classSubjectId: row.classSubjectId,
  studentId: row.studentId,
});
