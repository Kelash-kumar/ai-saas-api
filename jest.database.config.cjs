module.exports = {
  ...require('./jest.config.cjs'),
  testMatch: ['**/test/database/**/*.db-spec.ts'],
  testTimeout: 20000,
};
