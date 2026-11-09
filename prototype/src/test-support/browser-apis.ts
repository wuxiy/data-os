/**
 * 组件测试共用的浏览器 API stub：jsdom 不实现 matchMedia /
 * ResizeObserver / IntersectionObserver / Element.animate，而 Surface 等
 * 基建组件在挂载即用到。幂等，可在 beforeEach 里反复调用。
 */
export function installBrowserApiStubs() {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: ResizeObserverStub })
  }
  if (!('IntersectionObserver' in globalThis)) {
    class IntersectionObserverStub {
      root = null
      rootMargin = ''
      thresholds = []
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
    Object.defineProperty(globalThis, 'IntersectionObserver', { writable: true, value: IntersectionObserverStub })
  }
  if (!HTMLElement.prototype.animate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      writable: true,
      value: () => ({ finished: Promise.resolve(), cancel: () => {}, commit: () => {} }),
    })
  }
}
