/**
 * Conventional Commits enforcement for the backend.
 *
 * Run in CI rather than through a local git hook: git hooks live at the
 * repository root, which the frontend application also owns, so installing a
 * root-level hook is the owner's call rather than the backend engineer's.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'scope-empty': [2, 'never'],
    'body-max-line-length': [0, 'always'],
  },
};
