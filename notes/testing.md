## Running Tests

To run tests from the root directory, use:
```bash
yarn workspace {workspace_name} test
```

Examples:
```bash
yarn workspace @collabswarm/collabswarm test
yarn workspace @collabswarm/collabswarm-yjs test
yarn workspace @collabswarm/collabswarm-react test
```

## Test Coverage Summary

### Core Package (@collabswarm/collabswarm) - 32 tests
- ✅ Unit tests for JSON serialization/deserialization
- ✅ Unit tests for authentication (sign/verify, encrypt/decrypt)
- ✅ Unit tests for utility functions (arrays, promises, crypto keys)
- ✅ Integration tests for multi-user crypto scenarios

### Yjs Package (@collabswarm/collabswarm-yjs) - 7 tests
- ✅ Yjs document creation and management
- ✅ Base64 serialization utilities
- ✅ Document arrays and structures
- ✅ Multi-document independence

### React Package (@collabswarm/collabswarm-react) - 2 tests
- ✅ React context creation and functionality
- ✅ Provider and Consumer component verification

### Example Apps
- ✅ password-manager: Basic smoke test
- ✅ browser-test: Basic smoke test
- ✅ wiki-swarm: Basic smoke test

**Total: 41 tests across 6 test suites - All Passing ✅**

## Test Structure
- Use table-driven testing approach for comprehensive coverage
- Reference: https://dev.to/flyingdot/data-driven-unit-tests-with-jest-26bh

## Testing Approach

### Unit Tests
- Test individual modules and functions in isolation
- Use mock implementations where needed
- Focus on edge cases and error handling
- Avoid complex imports that require full dependency resolution

### Integration Tests
- Test multi-user scenarios
- Verify encryption/signing across different keys
- Validate data sharing with shared document keys

### Example Tests
- Basic smoke tests to ensure apps render without crashing
- Can be extended with more comprehensive UI tests as needed

## Dependencies
- **jest**: Testing framework (^29.2.5)
- **ts-jest**: TypeScript support for Jest (^29.2.5)
- **@testing-library/react**: React component testing (^16.0.1)
- **@testing-library/jest-dom**: Custom matchers for DOM assertions (^6.5.0)
- **@peculiar/webcrypto**: Crypto API polyfill for Node.js tests (^1.4.6)
- **jest-environment-jsdom**: DOM environment for React tests (^29.2.5)

## Notes
- All packages use Jest with TypeScript support
- Crypto tests require @peculiar/webcrypto for Node.js environment
- React tests require jsdom environment
- Tests are configured to ignore node_modules and use ts-jest transformer

