/**
 * Conventional Commits enforcement for the backend.
 *
 * Run in CI rather than through a local git hook: git hooks live at the
 * repository root, which the frontend application also owns, so installing one
 * there is the repository owner's call rather than the backend engineer's.
 *
 * A scope is encouraged but not required. The repository's CONTRIBUTING.md
 * documents `feat: add student attendance module` with no scope, and a lint
 * rule that rejects the project's own documented style is a rule that is
 * wrong. Backend commits still use one, because `feat:` is ambiguous in a
 * repository holding two applications and `feat(backend):` is not.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0, 'always'],
  },
};
