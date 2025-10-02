## Running Tests

To run tests from the root directory, use:
```bash
yarn workspace {workspace_name} test
```

Example:
```bash
yarn workspace @collabswarm/collabswarm test
```

## Test Coverage

### Core Package (@collabswarm/collabswarm)
- Unit tests for JSON serialization/deserialization
- Unit tests for authentication (sign/verify, encrypt/decrypt)
- Unit tests for utility functions (arrays, promises, crypto keys)
- Integration tests for multi-user crypto scenarios

### Test Structure
- Use table-driven testing approach for comprehensive coverage
- Reference: https://dev.to/flyingdot/data-driven-unit-tests-with-jest-26bh

### Current Test Status
- ✅ @collabswarm/collabswarm - 32 tests passing
- ✅ Examples have basic smoke tests
- 🔄 Additional packages (yjs, react, automerge, redux) - test infrastructure ready

## Testing Approach

### Unit Tests
- Test individual modules and functions in isolation
- Use mock implementations where needed
- Focus on edge cases and error handling

### Integration Tests
- Test multi-user scenarios
- Verify encryption/signing across different keys
- Validate data sharing with shared document keys

### Example Tests
- Basic smoke tests to ensure apps render without crashing
- Can be extended with more comprehensive UI tests as needed

## Dependencies
- jest: Testing framework
- @testing-library/react: React component testing
- @testing-library/jest-dom: Custom matchers for DOM assertions
- @peculiar/webcrypto: Crypto API polyfill for Node.js tests
