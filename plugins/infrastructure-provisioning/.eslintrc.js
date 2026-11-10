const config = require('@backstage/cli/config/eslint-factory')(__dirname);

config.overrides = [
  ...(config.overrides || []),
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      'no-nested-ternary': 'off',
    },
  },
];

module.exports = config;
