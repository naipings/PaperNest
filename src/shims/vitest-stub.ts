/** Minimal vitest stub so dsh-client-test-runtime can load outside Vitest. */
export const expect = {
  addSnapshotSerializer(_serializer: unknown) {},
};

export const vi = {
  fn: <T extends (...args: never[]) => unknown>(impl?: T) => impl ?? ((() => undefined) as T),
  spyOn: () => ({ mockImplementation: () => undefined }),
};

export function beforeEach(_fn: () => void) {}
export function afterEach(_fn: () => void) {}
