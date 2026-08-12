import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getTableViewConfiguration,
  saveTableViewConfiguration,
} from "@/server/table-view/table-views.serverFn";

export interface StoredColumnConfiguration {
  order: string[];
  hidden: string[];
}

const storageKey = (key: string) => `morph:data-table:${key}:columns`;

const normalizeOrder = (stored: string[], available: string[]) => [
  ...stored.filter((key) => available.includes(key)),
  ...available.filter((key) => !stored.includes(key)),
];

export const moveColumn = (order: string[], from: number, to: number) => {
  const next = [...order];
  const [item] = next.splice(from, 1);
  if (!item) return order;
  next.splice(to, 0, item);
  return next;
};

export const useDataTableColumnConfiguration = ({
  configurationKey,
  columnKeys,
  fixedKeys,
  defaultHiddenKeys,
  initialConfiguration,
}: {
  configurationKey?: string;
  columnKeys: string[];
  fixedKeys: ReadonlySet<string>;
  defaultHiddenKeys: ReadonlySet<string>;
  initialConfiguration?: StoredColumnConfiguration | null;
}) => {
  const [order, setOrder] = useState(() =>
    normalizeOrder(initialConfiguration?.order ?? [], columnKeys),
  );
  const [hidden, setHidden] = useState<Set<string>>(
    () =>
      new Set(
        columnKeys.filter((key) =>
          initialConfiguration
            ? initialConfiguration.hidden.includes(key) ||
              (!initialConfiguration.order.includes(key) && defaultHiddenKeys.has(key))
            : defaultHiddenKeys.has(key),
        ).filter(
          (key) => columnKeys.includes(key) && !fixedKeys.has(key),
        ),
      ),
  );
  const [hydrated, setHydrated] = useState(Boolean(initialConfiguration));

  useEffect(() => {
    if (!configurationKey) return;
    if (initialConfiguration) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    const hydrate = async () => {
      let fallback: StoredColumnConfiguration | null = null;
      try {
      const raw = localStorage.getItem(storageKey(configurationKey));
      if (raw) {
          fallback = JSON.parse(raw) as StoredColumnConfiguration;
        }
      } catch {
        // A malformed local fallback must not prevent the table from rendering.
      }

      try {
        const result = await getTableViewConfiguration({
          data: { tableKey: configurationKey },
        });
        if (result.success && result.data) {
          fallback = {
            order: result.data.columnOrder,
            hidden: result.data.hiddenColumns,
          };
        }
      } catch {
        // The database is authoritative when available; local storage keeps the
        // table usable offline or while a migration is being deployed.
      }

      if (!cancelled && fallback) {
        setOrder(normalizeOrder(fallback.order ?? [], columnKeys));
        setHidden(
          new Set(
            columnKeys.filter((key) =>
              (fallback.hidden ?? []).includes(key) ||
              (!(fallback.order ?? []).includes(key) && defaultHiddenKeys.has(key)),
            ).filter(
              (key) => columnKeys.includes(key) && !fixedKeys.has(key),
            ),
          ),
        );
      }
      if (!cancelled) setHydrated(true);
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [columnKeys, configurationKey, defaultHiddenKeys, fixedKeys, initialConfiguration]);

  useEffect(() => {
    if (!configurationKey || !hydrated) return;
    const configuration = { order, hidden: [...hidden] };
    localStorage.setItem(storageKey(configurationKey), JSON.stringify(configuration));

    const timeout = window.setTimeout(() => {
      void saveTableViewConfiguration({
        data: {
          tableKey: configurationKey,
          configuration: {
            columnOrder: configuration.order,
            hiddenColumns: configuration.hidden,
          },
        },
      }).catch(() => {
        // Local storage remains the last-known-good fallback.
      });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [configurationKey, hidden, hydrated, order]);

  const visibleOrder = useMemo(
    () => order.filter((key) => !hidden.has(key)),
    [hidden, order],
  );

  const toggle = useCallback(
    (key: string) => {
      if (fixedKeys.has(key)) return;
      setHidden((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [fixedKeys],
  );

  const reset = useCallback(() => {
    setOrder(columnKeys);
    setHidden(new Set(defaultHiddenKeys));
  }, [columnKeys, defaultHiddenKeys]);

  return { order, setOrder, hidden, visibleOrder, toggle, reset };
};
