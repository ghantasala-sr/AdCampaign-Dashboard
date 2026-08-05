import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

/**
 * jsdom has no layout engine: every element reports a zero-sized rect. The
 * virtualizer sizes its render window from the scroll container's rect, so
 * without this it concludes nothing is visible and renders zero rows — which
 * would make a "renders only a window of rows" test pass for the wrong reason.
 *
 * These stubs give the test environment a 1200x600 viewport. They are deliberately
 * here rather than as an `initialRect` prop on the component, so production code
 * carries no test-only configuration.
 */
const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 600;

for (const [property, value] of [
  ['clientHeight', VIEWPORT_HEIGHT],
  ['clientWidth', VIEWPORT_WIDTH],
  ['offsetHeight', VIEWPORT_HEIGHT],
  ['offsetWidth', VIEWPORT_WIDTH],
] as const) {
  Object.defineProperty(HTMLElement.prototype, property, {
    configurable: true,
    get() {
      return value;
    },
  });
}

HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: VIEWPORT_WIDTH,
    bottom: VIEWPORT_HEIGHT,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
  };
  return { ...rect, toJSON: () => rect } as DOMRect;
};

/**
 * The virtualizer subscribes to size changes via ResizeObserver and will not
 * measure until the callback fires at least once. A no-op stub leaves it waiting
 * forever, so this one reports the viewport immediately on observe.
 */
globalThis.ResizeObserver = class ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: target.getBoundingClientRect(),
          borderBoxSize: [{ blockSize: VIEWPORT_HEIGHT, inlineSize: VIEWPORT_WIDTH }],
          contentBoxSize: [{ blockSize: VIEWPORT_HEIGHT, inlineSize: VIEWPORT_WIDTH }],
          devicePixelContentBoxSize: [{ blockSize: VIEWPORT_HEIGHT, inlineSize: VIEWPORT_WIDTH }],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

// `next/dynamic` and the router are not under test here; the components that use
// them are exercised end-to-end by Playwright instead.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
