// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Blueprint rule 24: security context is never inferred from an untyped
      // value, so `any` is an error rather than a warning here.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The HTTP contract belongs to the module graph, not to an entry point.
    //
    // Registering a global on the application instance applies it only to the
    // bootstrap file that ran, so the worker and every future entry point go
    // without it. Registering it in both places is worse than either: BE-T02
    // shipped a main.ts that re-registered the response interceptor already
    // bound as APP_INTERCEPTOR, and every successful response came back with a
    // complete envelope nested inside its own data field.
    //
    // A unit test cannot catch this. Nest's testing module never executes
    // main.ts, so the suite was green while the running API was wrong. A lint
    // rule sees the source itself, which is the only layer that does.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^useGlobal(Pipes|Interceptors|Filters|Guards)$/]',
          message:
            'Bind this in the module graph instead: APP_PIPE, APP_INTERCEPTOR, APP_FILTER or ' +
            'APP_GUARD in a @Module providers array. Registering it on the application instance ' +
            'covers only this entry point, and doing both runs it twice.',
        },
      ],
    },
  },
  {
    // Only the two verified entry points may open a request or job context.
    //
    // A context is what every tenant-scoped action trusts: the school, the actor
    // and the role. TenantContextInterceptor opens one after verifying the token
    // and resolving the membership; JobContextService.runAsMember opens one after
    // reading the membership and role from the database. Any other caller would
    // be asserting identity without that verification, which review of BE-A02
    // flagged as the way a future worker or AI job could establish an unverified
    // tenant context. TypeScript cannot hide an exported function from other
    // files, so the restriction lives here, and context-entry-points.spec.ts
    // checks the same thing independently of this configuration.
    //
    // Spec files are exempt: a test building a fixture context is setting up a
    // precondition, not establishing anyone's identity.
    files: ['src/**/*.ts'],
    ignores: [
      'src/**/*.spec.ts',
      'src/tenancy/request-context.ts',
      'src/tenancy/tenant-context.interceptor.ts',
      'src/tenancy/job-context.service.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/request-context', '**/request-context.ts'],
              importNames: ['runWithRequestContext', 'enterVerifiedJobContext'],
              message:
                'Background work must use JobContextService.runAsMember, which verifies the ' +
                "actor's membership and reads the role from the database. Opening a context " +
                'directly asserts identity without verification.',
            },
          ],
        },
      ],
    },
  },
);
