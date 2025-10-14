# Repository Tests

Comprehensive test suite for all database repositories.

## Setup

Tests use Jest as the testing framework with TypeScript support.

### Prerequisites

- Node.js installed
- MongoDB running (tests connect to the database specified in `.env`)
- All dependencies installed: `npm install`

### Environment

Make sure your `.env` file has the correct MongoDB connection string:

```env
MONGODB_URI=mongodb://localhost:27017/your-test-database
```

**⚠️ WARNING**: Tests will create and delete real data in your database. Consider using a separate test database.

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode (auto-rerun on file changes)
```bash
npm run test:watch
```

### Run tests with coverage report
```bash
npm run test:coverage
```

### Run specific test file
```bash
npm test -- PromptRepository.test.ts
```

### Run tests matching a pattern
```bash
npm test -- --testNamePattern="create"
```

## Test Structure

```
__tests__/
├── PromptRepository.test.ts       # Tests for prompt CRUD operations
├── ExamRepository.test.ts         # Tests for exam creation and management
├── ExamSubmissionRepository.test.ts # Tests for completed submission operations
└── UserRepository.test.ts         # Tests for user management
```

## Test Coverage

Each test file covers:

- ✅ **Create operations** - Creating new documents with valid/invalid data
- ✅ **Read operations** - Retrieving documents by ID, field values, relationships
- ✅ **Update operations** - Modifying existing documents
- ✅ **Delete operations** - Removing documents
- ✅ **Validation** - Schema validation and error handling
- ✅ **Edge cases** - Duplicate prevention, non-existent IDs, pagination

## What Tests Cover

### PromptRepository
- Creating OCR, LLM, and user-generated prompts
- Retrieving prompts by ID, subject, and generation method
- Finding low-confidence OCR prompts
- Updating and deleting prompts
- Pagination

### ExamRepository
- Creating exams with questions from prompts
- MCQ and text question types
- Assigning exams to users
- Retrieving exams by creator, subject
- Updating and deleting exams

### ExamSubmissionRepository
- Creating completed submissions with mandatory scores
- Preventing duplicate submissions per exam/user
- Retrieving submissions by exam, user, score range
- Updating responses for re-evaluation
- Auto-submission tracking

### UserRepository
- Creating students, teachers, and admins
- Email uniqueness validation
- Retrieving users by ID, email, role
- Assigning exams to users
- Tracking submission history
- Updating user information and last login

## Test Data Cleanup

All tests follow the AAA pattern (Arrange, Act, Assert) and clean up after themselves:

- `beforeAll()` - Sets up test data needed for multiple tests
- `afterAll()` - Cleans up all created test data
- Tests track created IDs and delete them after completion

## Debugging Tests

### See detailed output
```bash
npm test -- --verbose
```

### Run a single test
```bash
npm test -- --testNamePattern="should create a new OCR prompt"
```

### Skip cleanup to inspect data
Comment out the `afterAll()` blocks in test files to keep test data in the database for inspection.

## Common Issues

### Tests timeout
- Increase timeout in `jest.config.js` (`testTimeout` option)
- Check MongoDB connection

### "Cannot find module" errors
- Run `npm install` to ensure all dependencies are installed
- Check that `jest.config.js` is properly configured for ESM

### Tests fail with validation errors
- Check that your MongoDB version supports the required features
- Verify schema definitions match test expectations
- Look at the actual error message for specific field issues

## Writing New Tests

Follow this template:

```typescript
describe('RepositoryName', () => {
  let repo: RepositoryClass;
  let createdIds: string[] = [];

  beforeAll(async () => {
    await connect();
    repo = new RepositoryClass();
  });

  afterAll(async () => {
    // Cleanup
    for (const id of createdIds) {
      await repo.delete(id);
    }
    await disconnect();
  });

  describe('methodName()', () => {
    it('should do something successfully', async () => {
      // Arrange
      const data = { /* test data */ };

      // Act
      const result = await repo.methodName(data);

      // Assert
      expect(result.success).toBe(true);
      if (result.id) createdIds.push(result.id);
    });
  });
});
```

## Test Philosophy

- **Isolation**: Each test is independent and can run in any order
- **Cleanup**: Tests clean up their own data
- **Real Database**: Tests use actual MongoDB (no mocks) to catch real integration issues
- **Comprehensive**: Cover happy paths, edge cases, and error conditions
- **Fast**: Tests run quickly enough for TDD workflow

## CI/CD Integration

To run tests in CI/CD:

```yaml
# Example GitHub Actions
- name: Run tests
  env:
    MONGODB_URI: ${{ secrets.MONGODB_URI }}
  run: npm test
```

Make sure to set up MongoDB in your CI environment or use a cloud MongoDB instance for testing.
