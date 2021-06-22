module.exports = {
  roots: ["<rootDir>/src"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  testRegex: "[json-serializer.test.ts\\$]",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node", "ts-jest"],
  testPathIgnorePatterns: ["/node_modules/", "utils-test.js"],
};
