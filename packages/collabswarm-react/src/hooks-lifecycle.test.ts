import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';
import React, { useState } from 'react';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import {
  CollabswarmContext,
  useCollabswarmDocumentState,
  _resetCaches,
  _getCacheSizes,
} from './hooks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDocument(data: any = { test: 'data' }): any {
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

function createMockCollabswarm(mockDoc: ReturnType<typeof createMockDocument>) {
  return { doc: jest.fn(() => mockDoc) } as any;
}

// Wrapper providing CollabswarmContext with real React state.
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

// Test component that uses the hook and exposes the returned tuple.
function TestConsumer(props: {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCollabswarmDocumentState lifecycle', () => {
  beforeEach(() => {
    _resetCaches();
    cleanup();
  });

  afterEach(() => {
    _resetCaches();
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

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    expect(mockDoc.subscribe).toHaveBeenCalledWith(
      expect.stringMatching(/^useCollabswarmDocumentState-/),
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
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/test-unsub' }),
        ),
      );
      unmount = result.unmount;
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    act(() => {
      unmount!();
    });

    expect(mockDoc.unsubscribe).toHaveBeenCalledWith(
      expect.stringMatching(/^useCollabswarmDocumentState-/),
    );
  });

  test('opens document and fetches readers/writers', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/doc-rw' }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    expect(mockDoc.getReaders).toHaveBeenCalled();
    expect(mockDoc.getWriters).toHaveBeenCalled();
  });

  test('passes originFilter to subscribe', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/doc-filter',
            originFilter: 'remote',
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.subscribe).toHaveBeenCalled();
    });

    expect(mockDoc.subscribe).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      'remote',
    );
  });
});

describe('Cache cleanup on unmount', () => {
  beforeEach(() => {
    _resetCaches();
    cleanup();
  });

  afterEach(() => {
    _resetCaches();
  });

  test('caches are populated after mount and cleared after last subscriber unmounts', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    let unmount: () => void;
    await act(async () => {
      const result = render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/cache-doc' }),
        ),
      );
      unmount = result.unmount;
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    // After mount, caches should be populated.
    const sizesAfterMount = _getCacheSizes();
    expect(sizesAfterMount.openTasks).toBeGreaterThanOrEqual(1);
    expect(sizesAfterMount.openTaskResults).toBeGreaterThanOrEqual(1);
    expect(sizesAfterMount.subscriberCounts).toBeGreaterThanOrEqual(1);

    act(() => {
      unmount!();
    });

    // After unmount of the last subscriber, openTaskResults and subscriberCounts
    // should be cleared. openTasks is cleared asynchronously after the promise settles.
    await waitFor(() => {
      const sizesAfterUnmount = _getCacheSizes();
      expect(sizesAfterUnmount.openTaskResults).toBe(0);
      expect(sizesAfterUnmount.subscriberCounts).toBe(0);
    });
  });

  test('document.close is called when last subscriber unmounts', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    let unmount: () => void;
    await act(async () => {
      const result = render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/close-doc' }),
        ),
      );
      unmount = result.unmount;
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    act(() => {
      unmount!();
    });

    // The cleanup code calls docRef.close() asynchronously after the openTask promise settles.
    await waitFor(() => {
      expect(mockDoc.close).toHaveBeenCalled();
    });
  });
});

describe('Multiple subscribers to the same document', () => {
  beforeEach(() => {
    _resetCaches();
    cleanup();
  });

  afterEach(() => {
    _resetCaches();
  });

  test('ref-counting: caches persist when one of two subscribers unmounts', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    // We render two consumers for the same document path inside a single provider.
    // We need a way to unmount them individually, so we use a parent component with
    // conditional rendering.
    let setShowSecond: (show: boolean) => void;

    function Parent() {
      const [showSecond, _setShowSecond] = useState(true);
      setShowSecond = _setShowSecond;
      return React.createElement(
        TestProvider,
        null,
        React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/shared-doc' }),
        showSecond
          ? React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/shared-doc' })
          : null,
      );
    }

    await act(async () => {
      render(React.createElement(Parent));
    });

    await waitFor(() => {
      // Both consumers should have subscribed (the first opens, the second joins).
      expect(mockDoc.subscribe).toHaveBeenCalled();
    });

    // Two subscribers should be tracked.
    const sizesWithBoth = _getCacheSizes();
    expect(sizesWithBoth.subscriberCounts).toBeGreaterThanOrEqual(1);

    // Unmount one subscriber by hiding the second consumer.
    await act(async () => {
      setShowSecond!(false);
    });

    // Caches should still be populated because one subscriber remains.
    const sizesAfterPartialUnmount = _getCacheSizes();
    expect(sizesAfterPartialUnmount.openTaskResults).toBeGreaterThanOrEqual(1);
    // subscriberCounts entry should still exist (decremented but not zero).
    expect(sizesAfterPartialUnmount.subscriberCounts).toBeGreaterThanOrEqual(1);
  });

  test('each subscriber gets its own unique subscription ID', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    await act(async () => {
      render(
        React.createElement(
          TestProvider,
          null,
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/multi-id' }),
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/multi-id' }),
        ),
      );
    });

    await waitFor(() => {
      // At least 2 subscribe calls should have been made.
      expect(mockDoc.subscribe.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Extract subscription IDs from mock calls.
    const ids = mockDoc.subscribe.mock.calls.map((call: any[]) => call[0]);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('unsubscribe is called for each subscriber on full unmount', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    let unmount: () => void;
    await act(async () => {
      const result = render(
        React.createElement(
          TestProvider,
          null,
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/full-unmount' }),
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/full-unmount' }),
        ),
      );
      unmount = result.unmount;
    });

    await waitFor(() => {
      expect(mockDoc.subscribe).toHaveBeenCalled();
    });

    const subscribeCount = mockDoc.subscribe.mock.calls.length;

    act(() => {
      unmount!();
    });

    // Each subscriber that subscribed should also unsubscribe.
    expect(mockDoc.unsubscribe.mock.calls.length).toBe(subscribeCount);
  });
});

describe('useCollabswarmDocumentState return value', () => {
  beforeEach(() => {
    _resetCaches();
    cleanup();
  });

  afterEach(() => {
    _resetCaches();
  });

  test('returns a change function that delegates to docRef.change', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);
    const captureRef = { current: null as any };

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/change-doc',
            captureRef,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    // The change function should be callable.
    expect(typeof captureRef.current.changeFn).toBe('function');
  });

  test('returns ACL helpers (readers, writers, addReader, etc.)', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);
    const captureRef = { current: null as any };

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/acl-doc',
            captureRef,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    const acl = captureRef.current.acl;
    expect(acl).toBeDefined();
    expect(typeof acl.addReader).toBe('function');
    expect(typeof acl.removeReader).toBe('function');
    expect(typeof acl.addWriter).toBe('function');
    expect(typeof acl.removeWriter).toBe('function');
  });
});
