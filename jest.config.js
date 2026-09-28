module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/n8n-instance/'],
};
