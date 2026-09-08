# Contributing to CyberSchola

Thank you for contributing to CyberSchola.

CyberSchola is a multi-tenant school management platform. Because the system handles important school operations and data, all contributors are expected to follow the development and review workflow described below.

## 1. Development Workflow

CyberSchola uses the following branch structure:

- `main` — production/stable code
- `develop` — integration/staging branch
- `feature/*` — new features
- `bugfix/*` — bug fixes
- `refactor/*` — code refactoring
- `docs/*` — documentation changes
- `hotfix/*` — urgent production fixes

Developers must not directly push changes to `main` or `develop`.

All changes must be made on a dedicated working branch and submitted through a Pull Request.

### Example

```text
feature/student-attendance
feature/teacher-copilot
bugfix/payment-validation
refactor/authentication
```

## 2. Creating a Branch

Always start from the latest `develop` branch:

```bash
git switch develop
git pull origin develop
git switch -c feature/your-feature-name
```

Use a short and descriptive branch name.

## 3. Making Changes

Before starting development:

```bash
git pull origin develop
```

Keep changes focused.

A Pull Request should ideally address one feature, bug, improvement, or related task rather than combining unrelated changes.

Do not commit:

- API keys
- passwords
- access tokens
- private keys
- database credentials
- `.env` files
- other sensitive information

Never commit secrets to the repository.

## 4. Commit Messages

Use clear, consistent commit messages.

Recommended prefixes:

```text
feat: add student attendance module
fix: resolve teacher login issue
refactor: simplify authentication service
docs: update contributing guide
test: add attendance tests
chore: update dependencies
security: improve API authorization
```

Keep the commit message short and describe what changed.

## 5. Pull Requests

When your work is ready:

```bash
git push -u origin feature/your-feature-name
```

Then open a Pull Request targeting:

```text
feature/* → develop
```

Every Pull Request must:

- Clearly describe the change
- Explain relevant implementation details
- Include testing information
- Pass required automated checks
- Have the required reviewer approval
- Resolve review conversations
- Address requested changes before merging

Do not merge your own Pull Request when a review is required.

## 6. Code Review

Code review is required before changes enter protected branches.

Reviewers should consider:

- Correctness
- Security
- Performance
- Maintainability
- Type safety
- Error handling
- Database impact
- API authorization
- Multi-tenant data isolation
- User experience
- Test coverage

Reviewers should explain problems clearly and constructively.

Approval should only be given when the reviewer is satisfied that the changes are safe to merge.

## 7. Protected Branches

The following branches are protected:

```text
main
develop
```

Direct pushes to these branches are not permitted.

Changes must enter protected branches through Pull Requests and the required review process.

### Production flow

```text
feature/*
    ↓
Pull Request
    ↓
Review
    ↓
develop
    ↓
Testing / Validation
    ↓
Pull Request
    ↓
Review
    ↓
main
```

## 8. Database Changes

Any change involving Prisma or the database must be reviewed carefully.

Examples include:

- Prisma schema changes
- New migrations
- Changes to existing migrations
- Seed data changes
- Changes to database relationships
- Changes affecting tenant isolation

Never modify an already-applied production migration simply to make it work locally.

Create a new migration when a database change is required.

## 9. Multi-Tenant Security

CyberSchola is a multi-tenant application.

Every feature that accesses school data must respect tenant boundaries.

Developers must ensure that users cannot access, modify, or expose data belonging to another school or tenant.

Particular attention must be given to:

- API routes
- Server actions
- Database queries
- Authentication
- Authorization
- Admin functionality
- File uploads
- Messaging
- Payments
- AI/RAG features

Security-sensitive changes should receive careful code review before merging.

## 10. AI Features

AI-generated output must not automatically be treated as authoritative.

AI features must respect:

- User permissions
- School/tenant boundaries
- Data privacy
- Access control
- Appropriate human oversight

AI features that can create or modify important school data should include appropriate validation and authorization.

## 11. Testing

Before opening a Pull Request, contributors should run the available project checks.

At minimum, verify:

```text
- TypeScript
- ESLint
- Tests
- Production build
```

If a check cannot be run, explain the reason in the Pull Request.

## 12. Pull Request Checklist

Before requesting review, confirm:

- [ ] My changes are limited to the intended task
- [ ] I tested my changes locally
- [ ] TypeScript passes
- [ ] ESLint passes
- [ ] Tests pass where applicable
- [ ] Production build passes
- [ ] No secrets were committed
- [ ] Database changes have been reviewed
- [ ] Tenant isolation has been considered
- [ ] Authentication and authorization have been considered
- [ ] The Pull Request description is complete
- [ ] Screenshots/recordings are included when relevant

## 13. Emergency Production Fixes

Urgent production issues may use a `hotfix/*` branch.

Example:

```text
hotfix/payment-security-issue
```

Hotfixes must still go through the repository's required review and protection rules.

## 14. Questions and Discussions

If you are unsure about an implementation, security decision, database change, or architectural decision, discuss it with the project maintainers before introducing a significant change.

When in doubt, prioritize:

1. Security
2. Data integrity
3. Tenant isolation
4. Reliability
5. Maintainability
6. User experience
