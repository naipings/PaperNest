type LocaleDict = Record<string, string>;

type LocaleSnapshot = {
  active: "zh";
  locales: { id: "zh"; label: string }[];
  revision: number;
};

/** LocaleFace 最小实现，供 slots.installLocale + trajectory 插件 register 使用 */
export function createStubLocale() {
  const dicts = new Map<string, LocaleDict>();
  const listeners = new Set<() => void>();
  let revision = 0;

  const getSnapshot = (): LocaleSnapshot => ({
    active: "zh",
    locales: [{ id: "zh", label: "中文" }],
    revision,
  });

  const notify = () => {
    for (const fn of [...listeners]) fn();
  };

  return {
    register(ns: string, dictionaries: { zh: LocaleDict; en: LocaleDict }) {
      dicts.set(ns, dictionaries.zh);
      revision += 1;
      notify();
      return () => {
        dicts.delete(ns);
        revision += 1;
        notify();
      };
    },
    bind(ns: string) {
      const dict = dicts.get(ns) ?? {};
      return (key: string, params?: Record<string, unknown>) => {
        let template = dict[key] ?? key;
        if (params) {
          template = template.replace(/\{(\w+)\}/g, (match, name) =>
            name in params ? String(params[name]) : match,
          );
        }
        return template;
      };
    },
    getLocale: getSnapshot,
    getSnapshot,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
