import '@testing-library/jest-dom/vitest';

// Route changes scroll in the browser; jsdom deliberately leaves this API
// unimplemented, so make it a harmless test-environment no-op.
Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });
