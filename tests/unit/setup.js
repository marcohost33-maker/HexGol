// Vitest setup file. Adds @testing-library/jest-dom matchers if available,
// otherwise stays a noop so unit tests covering pure functions still run.
try {
  await import("@testing-library/jest-dom/vitest");
} catch (err) {
  // jest-dom not installed in some environments - that is acceptable.
}
