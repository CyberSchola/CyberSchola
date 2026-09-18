/**
 * The people a staging demo signs in as.
 *
 * Fixed ids, because two separate processes have to agree on them: the demo
 * seed gives each one a membership and a role, and the staging demo sign-in
 * issues tokens whose subject is the id. `deploy/staging/demo-auth/server.mjs`
 * keeps its own copy, since it runs without this package, and a unit test
 * holds the two lists equal.
 *
 * None of these can sign in anywhere real. A token is only accepted by an API
 * configured to trust the staging demo issuer, which production refuses to be.
 */
export const DEMO_SCHOOL_ID = 'c5c10000-0000-4000-8000-000000000001';
export const DEMO_OTHER_SCHOOL_ID = 'c5c10000-0000-4000-8000-000000000002';

export interface DemoUser {
  readonly key: string;
  readonly userId: string;
  readonly label: string;
}

export const DEMO_USERS: readonly DemoUser[] = [
  {
    key: 'admin',
    userId: 'd3300000-0000-4000-8000-000000000001',
    label: 'School administrator, Greenfield College',
  },
  {
    key: 'teacher',
    userId: 'd3300000-0000-4000-8000-000000000002',
    label: 'Adaeze Okonkwo, teacher and JSS 2 A form teacher',
  },
  {
    key: 'teacherParent',
    userId: 'd3300000-0000-4000-8000-000000000003',
    label: 'Obi Nwosu, teacher, and father of Tunde in JSS 2 B',
  },
  {
    key: 'parent',
    userId: 'd3300000-0000-4000-8000-000000000004',
    label: 'Funmi Abubakar, parent of Zainab',
  },
  {
    key: 'student',
    userId: 'd3300000-0000-4000-8000-000000000005',
    label: 'Zainab Abubakar, pupil in JSS 2 A',
  },
  {
    key: 'staff',
    userId: 'd3300000-0000-4000-8000-000000000006',
    label: 'Bayo Adewale, bursar (staff)',
  },
  {
    key: 'otherSchoolAdmin',
    userId: 'd3300000-0000-4000-8000-000000000007',
    label: 'Administrator of Brookvale Academy, a different school',
  },
];
