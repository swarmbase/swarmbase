import { jest } from '@jest/globals';
import React, { useState } from 'react';
import { CollabswarmContext, useCollabswarmDocumentState } from './hooks';
import { openTasks, openTaskResults, subscriberCounts } from './hooks-cache';

/** Reset all module-level caches. Test-only helper. */
export function resetCaches() {
  openTasks.clear();
  openTaskResults.clear();
  subscriberCounts.clear();
}

/** Read-only access to module-level cache sizes. Test-only helper. */
export function getCacheSizes() {
  return {
    openTasks: openTasks.size,
    openTaskResults: openTaskResults.size,
    subscriberCounts: subscriberCounts.size,
  };
}

export function createMockDocument(data: any = { test: 'data' }): any {
  const subscriptions = new Map<string, { handler: Function; filter: string }>();
  return {
    open: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    getReaders: jest.fn(() => Promise.resolve(['reader1'])),
    getWriters: jest.fn(() => Promise.resolve(['writer1'])),
    document: data,
    change: jest.fn(),
    addReader: jest.fn(() => Promise.resolve()),
    removeReader: jest.fn(() => Promise.resolve()),
    addWriter: jest.fn(() => Promise.resolve()),
    removeWriter: jest.fn(() => Promise.resolve()),
    subscribe: jest.fn((id: string, handler: Function, filter: string) => {
      subscriptions.set(id, { handler, filter });
    }),
    unsubscribe: jest.fn((id: string) => {
      subscriptions.delete(id);
    }),
    _subscriptions: subscriptions,
  };
}

export function createMockCollabswarm(mockDoc: any) {
  return { doc: jest.fn(() => mockDoc) } as any;
}

export function createMockCollabswarmMultiDoc(docMap: Record<string, any>) {
  return {
    doc: jest.fn((path: string) => docMap[path] || null),
  } as any;
}

// Wrapper providing CollabswarmContext with real React state.
export function TestProvider(props: { children: React.ReactNode }) {
  const [docCache, setDocCache] = useState<Record<string, any>>({});
  const [docDataCache, setDocDataCache] = useState<Record<string, any>>({});
  const [docReadersCache, setDocReadersCache] = useState<Record<string, any[]>>({});
  const [docWritersCache, setDocWritersCache] = useState<Record<string, any[]>>({});
  return React.createElement(
    CollabswarmContext.Provider,
    {
      value: {
        docCache, docDataCache, docReadersCache, docWritersCache,
        setDocCache, setDocDataCache, setDocReadersCache, setDocWritersCache,
      },
    },
    props.children,
  );
}

// Test component that uses the hook and exposes the returned tuple.
export function TestConsumer(props: {
  collabswarm: any;
  documentPath: string;
  originFilter?: 'all' | 'remote' | 'local';
  captureRef?: { current: any };
}) {
  const [docData, changeFn, acl] = useCollabswarmDocumentState(
    props.collabswarm,
    props.documentPath,
    props.originFilter,
  );
  if (props.captureRef) {
    props.captureRef.current = { docData, changeFn, acl };
  }
  return React.createElement('div', { 'data-testid': 'doc-data' }, JSON.stringify(docData));
}
