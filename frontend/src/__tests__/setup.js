import '@testing-library/jest-dom';

// TimeWindowSlider reads window.matchMedia at module load time to detect mobile.
// jsdom doesn't implement matchMedia so we stub it here.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
