import { useEffect, useState, useRef } from 'react';
import { IndexManager } from './index-manager';
import { IndexDefinition, QueryOptions, QueryResult } from './types';

/**
 * React hook that subscribes to live index query results.
 * Re-runs the query when the result set changes and when options change.
 *
 * @param manager The IndexManager to query against.
 * @param options Query options (filters, sort, limit, offset, etc.).
 * @returns The current query result, updated reactively.
 */
export function useIndexQuery(
  manager: IndexManager<unknown>,
  options: QueryOptions,
): QueryResult<Record<string, unknown>> {
  const [result, setResult] = useState<QueryResult<Record<string, unknown>>>({
    documents: [],
    totalCount: 0,
  });

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const serialized = JSON.stringify(options);
    const unsub = manager.subscribe(options, (newResult) => {
      setResult(newResult);
    });

    return unsub;
    // Re-subscribe when serialized options change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, JSON.stringify(options)]);

  return result;
}

/**
 * React hook that defines indexes on mount and removes them on unmount.
 *
 * @param manager The IndexManager to define indexes on.
 * @param definitions Array of index definitions to register.
 */
export function useDefineIndexes(
  manager: IndexManager<unknown>,
  definitions: IndexDefinition[],
): void {
  useEffect(() => {
    const names: string[] = [];

    for (const def of definitions) {
      names.push(def.name);
      manager.defineIndex(def).catch(() => {});
    }

    return () => {
      for (const name of names) {
        manager.removeIndex(name).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, JSON.stringify(definitions)]);
}
