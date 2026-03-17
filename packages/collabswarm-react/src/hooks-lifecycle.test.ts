import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import React, { useState } from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { CollabswarmContext, useCollabswarmDocumentState } from './hooks';

// Mock document with subscribe/unsubscribe tracking
function createMockDocument(): any {
  const subscriptions = new Map<string, Function>();
  return {
    open: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    getReaders: jest.fn(() => Promise.resolve([])),
    getWriters: jest.fn(() => Promise.resolve([])),
    document: { test: 'data' },
    subscribe: jest.fn((id: string, handler: Function) => {
      subscriptions.set(id, handler);
    }),
    unsubscribe: jest.fn((id: string) => {
      subscriptions.delete(id);
    }),
    _subscriptions: subscriptions,
  };
}

function createMockCollabswarm(mockDoc: ReturnType<typeof createMockDocument>) {
  return { doc: jest.fn(() => mockDoc) } as any;
}

// Wrapper providing context — uses React.createElement to avoid JSX
function TestProvider(props: { children: React.ReactNode }) {
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

// Test component that uses the hook
function TestConsumer(props: { collabswarm: any; documentPath: string }) {
  const [docData] = useCollabswarmDocumentState(props.collabswarm, props.documentPath);
  return React.createElement('div', { 'data-testid': 'doc-data' }, JSON.stringify(docData));
}

describe('useCollabswarmDocumentState lifecycle', () => {
  beforeEach(() => {
    cleanup();
  });

  test('subscribe is called on mount', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/test-doc' }),
        ),
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockDoc.open).toHaveBeenCalled();
    expect(mockDoc.subscribe).toHaveBeenCalledWith(
      'useCollabswarmDocumentState',
      expect.any(Function),
      'all',
    );
  });

  test('unsubscribe is called on unmount', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    let unmount: () => void;
    await act(async () => {
      const result = render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/test-doc' }),
        ),
      );
      unmount = result.unmount;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    act(() => {
      unmount!();
    });

    expect(mockDoc.unsubscribe).toHaveBeenCalledWith('useCollabswarmDocumentState');
  });
});
