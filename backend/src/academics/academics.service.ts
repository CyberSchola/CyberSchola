import { Injectable } from '@nestjs/common';
import type { DeepPartial, EntityManager } from 'typeorm';

import {
  ResourceConflictException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../common/exceptions/app.exception';
import type { TenantOwnedEntity } from '../common/entities/tenant-owned.entity';
import type { Page, PageRequest } from '../common/pagination/pagination';
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
  ReassignClassSubjectDto,
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
import { Subject } from './entities/subject.entity';
import { Term } from './entities/term.entity';
import { RecordAction } from '../common/actions/record.action';
import { reassignmentClash } from '../timetable/timetable-clashes';

/**
 * The academic spine: structure and assignments.
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
   * Hands a class subject to another teacher, and its timetabled lessons with it.
   *
   * The lessons follow through the foreign key's ON UPDATE CASCADE, in this one
   * statement, so there is no moment where the subject and its lessons disagree
   * about who teaches them. If the new teacher already teaches in one of those
   * periods, the timetable's teacher index refuses the whole update and nothing
   * changes. The pre-check only puts that refusal into words; a race past it
   * still meets the index, as a plain 409.
   *
   * A teacher from another school is a 404, from the foreign key to `teachers`.
   */
  reassignClassSubject(id: string, input: ReassignClassSubjectDto): Promise<ClassSubjectDto> {
    return this.inSchool(async (manager) => {
      const assignment = await manager.findOne(ClassSubject, { where: { id } });

      if (!assignment) {
        throw new ResourceNotFoundException();
      }

      if (assignment.teacherId === input.teacherId) {
        return toClassSubjectDto(assignment);
      }

      const clash = await reassignmentClash(manager, requireTenantId(), id, input.teacherId);

      if (clash !== null) {
        throw new ResourceConflictException(clash);
      }

      await manager.update(ClassSubject, { id }, { teacherId: input.teacherId });

      return toClassSubjectDto({ ...assignment, teacherId: input.teacherId });
    });
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
