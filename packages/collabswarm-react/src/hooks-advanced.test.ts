import { describe, expect, test, jest, afterEach } from '@jest/globals';
import React, { useState } from 'react';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { CollabswarmContext, useCollabswarmDocumentState } from './hooks';
import { openTasks, openTaskResults, subscriberCounts } from './hooks-cache';

/** Reset all module-level caches. */
function resetCaches() {
  openTasks.clear();
  openTaskResults.clear();
  subscriberCounts.clear();
}

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

function createMockCollabswarm(mockDoc: any) {
  return { doc: jest.fn(() => mockDoc) } as any;
}

function createMockCollabswarmMultiDoc(docMap: Record<string, any>) {
  return {
    doc: jest.fn((path: string) => docMap[path] || null),
  } as any;
}

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
// Tests: Subscription callback behavior
// ---------------------------------------------------------------------------

describe('Subscription callback updates state', () => {
  afterEach(() => {
    cleanup();
    resetCaches();
  });

  test('subscription callback updates document data in context', async () => {
    const mockDoc = createMockDocument({ initial: true });
    const mockSwarm = createMockCollabswarm(mockDoc);
    const captureRef = { current: null as any };

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/sub-callback',
            captureRef,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.subscribe).toHaveBeenCalled();
    });

    // Simulate a document change by calling the subscription handler.
    const subscribeCall = mockDoc.subscribe.mock.calls[0];
    const handler = subscribeCall[1] as Function;

    await act(async () => {
      handler({ updated: true }, ['reader1', 'reader2'], ['writer1', 'writer2']);
    });

    await waitFor(() => {
      expect(captureRef.current.docData).toEqual({ updated: true });
    });

    expect(captureRef.current.acl.readers).toEqual(['reader1', 'reader2']);
    expect(captureRef.current.acl.writers).toEqual(['writer1', 'writer2']);
  });

  test('subscription callback updates readers and writers independently', async () => {
    const mockDoc = createMockDocument({ text: 'hello' });
    const mockSwarm = createMockCollabswarm(mockDoc);
    const captureRef = { current: null as any };

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/rw-update',
            captureRef,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.subscribe).toHaveBeenCalled();
    });

    const handler = mockDoc.subscribe.mock.calls[0][1] as Function;

    // First update: only change readers.
    await act(async () => {
      handler({ text: 'hello' }, ['newReader'], ['writer1']);
    });

    await waitFor(() => {
      expect(captureRef.current.acl.readers).toEqual(['newReader']);
    });

    // Second update: change writers.
    await act(async () => {
      handler({ text: 'hello' }, ['newReader'], ['newWriter']);
    });

    await waitFor(() => {
      expect(captureRef.current.acl.writers).toEqual(['newWriter']);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: ACL helper functions
// ---------------------------------------------------------------------------

describe('ACL helper functions delegate to docRef', () => {
  afterEach(() => {
    cleanup();
    resetCaches();
  });

  test('addReader calls docRef.addReader with the given key', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);
    const captureRef = { current: null as any };

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/acl-add-reader',
            captureRef,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    // Wait for caches to be populated so docRef is in docCache.
    await waitFor(() => {
      expect(captureRef.current.acl).toBeDefined();
    });

    await act(async () => {
      await captureRef.current.acl.addReader('newUserPubKey');
    });

    expect(mockDoc.addReader).toHaveBeenCalledWith('newUserPubKey');
  });

  test('removeReader calls docRef.removeReader with the given key', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);
    const captureRef = { current: null as any };

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/acl-rm-reader',
            captureRef,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    await act(async () => {
      await captureRef.current.acl.removeReader('oldUserPubKey');
    });

    expect(mockDoc.removeReader).toHaveBeenCalledWith('oldUserPubKey');
  });

  test('addWriter calls docRef.addWriter with the given key', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);
    const captureRef = { current: null as any };

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/acl-add-writer',
            captureRef,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    await act(async () => {
      await captureRef.current.acl.addWriter('writerPubKey');
    });

    expect(mockDoc.addWriter).toHaveBeenCalledWith('writerPubKey');
  });

  test('removeWriter calls docRef.removeWriter with the given key', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);
    const captureRef = { current: null as any };

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/acl-rm-writer',
            captureRef,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    await act(async () => {
      await captureRef.current.acl.removeWriter('oldWriterPubKey');
    });

    expect(mockDoc.removeWriter).toHaveBeenCalledWith('oldWriterPubKey');
  });
});

// ---------------------------------------------------------------------------
// Tests: Change function edge cases
// ---------------------------------------------------------------------------

describe('Change function edge cases', () => {
  afterEach(() => {
    cleanup();
    resetCaches();
  });

  test('change function does not throw when called without a message', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);
    const captureRef = { current: null as any };

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/change-no-msg',
            captureRef,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    const changeFnArg = jest.fn();
    expect(() => captureRef.current.changeFn(changeFnArg)).not.toThrow();
    expect(mockDoc.change).toHaveBeenCalledWith(changeFnArg, undefined);
  });

  test('change function is a no-op when docRef is not yet in cache', () => {
    // Render without provider setting up docCache - use default context.
    const captureRef = { current: null as any };
    const mockSwarm = { doc: jest.fn() } as any;

    // Use the default context (no provider) so docCache is empty.
    render(
      React.createElement(TestConsumer, {
        collabswarm: mockSwarm,
        documentPath: '/not-loaded',
        captureRef,
      }),
    );

    // changeFn should be defined but should not throw.
    expect(typeof captureRef.current.changeFn).toBe('function');
    expect(() => captureRef.current.changeFn(() => {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests: Multiple different document paths
// ---------------------------------------------------------------------------

describe('Multiple different document paths', () => {
  afterEach(() => {
    cleanup();
    resetCaches();
  });

  test('opening two different documents creates separate entries in caches', async () => {
    const mockDocA = createMockDocument({ doc: 'A' });
    const mockDocB = createMockDocument({ doc: 'B' });
    const mockSwarm = createMockCollabswarmMultiDoc({
      '/doc-a': mockDocA,
      '/doc-b': mockDocB,
    });

    const captureA = { current: null as any };
    const captureB = { current: null as any };

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/doc-a',
            captureRef: captureA,
          }),
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/doc-b',
            captureRef: captureB,
          }),
        ),
      );
    });

    await waitFor(() => {
      expect(mockDocA.open).toHaveBeenCalled();
      expect(mockDocB.open).toHaveBeenCalled();
    });

    // Both documents should have their own cache entries.
    expect(openTaskResults.has('/doc-a')).toBe(true);
    expect(openTaskResults.has('/doc-b')).toBe(true);

    // Subscriber counts should exist for both paths.
    expect(subscriberCounts.get('/doc-a')).toBe(1);
    expect(subscriberCounts.get('/doc-b')).toBe(1);
  });

  test('unmounting one document does not affect the other', async () => {
    const mockDocA = createMockDocument({ doc: 'A' });
    const mockDocB = createMockDocument({ doc: 'B' });
    const mockSwarm = createMockCollabswarmMultiDoc({
      '/doc-x': mockDocA,
      '/doc-y': mockDocB,
    });

    let setShowA: (show: boolean) => void;

    function Parent() {
      const [showA, _setShowA] = useState(true);
      setShowA = _setShowA;
      return React.createElement(
        TestProvider,
        null,
        showA
          ? React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/doc-x' })
          : null,
        React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/doc-y' }),
      );
    }

    await act(async () => {
      render(React.createElement(Parent));
    });

    await waitFor(() => {
      expect(mockDocA.open).toHaveBeenCalled();
      expect(mockDocB.open).toHaveBeenCalled();
    });

    // Unmount document A.
    await act(async () => {
      setShowA!(false);
    });

    // Document B should still have cache entries.
    await waitFor(() => {
      expect(openTaskResults.has('/doc-y')).toBe(true);
    });

    // Document A caches should be cleaned up.
    await waitFor(() => {
      expect(subscriberCounts.has('/doc-x')).toBe(false);
      expect(openTaskResults.has('/doc-x')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Error handling
// ---------------------------------------------------------------------------

describe('Error handling', () => {
  afterEach(() => {
    cleanup();
    resetCaches();
  });

  test('collabswarm.doc returning null does not throw', async () => {
    const mockSwarm = { doc: jest.fn(() => null) } as any;

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, { collabswarm: mockSwarm, documentPath: '/null-doc' }),
        ),
      );
    });

    // Give async effect time to run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Should have warned about failing to open/find the document.
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to open/find document'),
    );

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Tests: originFilter variants
// ---------------------------------------------------------------------------

describe('originFilter variants', () => {
  afterEach(() => {
    cleanup();
    resetCaches();
  });

  test('defaults to "all" when originFilter is not specified', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/filter-default',
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
      'all',
    );
  });

  test('passes "local" originFilter to subscribe', async () => {
    const mockDoc = createMockDocument();
    const mockSwarm = createMockCollabswarm(mockDoc);

    await act(async () => {
      render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/filter-local',
            originFilter: 'local',
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
      'local',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: Late joiner (second subscriber awaits existing open task)
// ---------------------------------------------------------------------------

describe('Late joiner subscribes via existing open task', () => {
  afterEach(() => {
    cleanup();
    resetCaches();
  });

  test('second subscriber joins after first has opened the document', async () => {
    const mockDoc = createMockDocument({ shared: true });
    const mockSwarm = createMockCollabswarm(mockDoc);
    const captureA = { current: null as any };
    const captureB = { current: null as any };

    let setShowSecond: (show: boolean) => void;

    function Parent() {
      const [showSecond, _setShowSecond] = useState(false);
      setShowSecond = _setShowSecond;
      return React.createElement(
        TestProvider,
        null,
        React.createElement(TestConsumer, {
          collabswarm: mockSwarm,
          documentPath: '/late-join',
          captureRef: captureA,
        }),
        showSecond
          ? React.createElement(TestConsumer, {
              collabswarm: mockSwarm,
              documentPath: '/late-join',
              captureRef: captureB,
            })
          : null,
      );
    }

    // Mount first subscriber.
    await act(async () => {
      render(React.createElement(Parent));
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    // Now add the second subscriber after document is already open.
    await act(async () => {
      setShowSecond!(true);
    });

    // Second subscriber should also subscribe.
    await waitFor(() => {
      expect(mockDoc.subscribe.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // The document should only have been opened once.
    expect(mockDoc.open).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Document data rendering
// ---------------------------------------------------------------------------

describe('Document data rendering', () => {
  afterEach(() => {
    cleanup();
    resetCaches();
  });

  test('renders initial document data after open completes', async () => {
    const mockDoc = createMockDocument({ title: 'My Doc' });
    const mockSwarm = createMockCollabswarm(mockDoc);

    let container: HTMLElement;
    await act(async () => {
      const result = render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/render-doc',
          }),
        ),
      );
      container = result.container;
    });

    await waitFor(() => {
      expect(mockDoc.open).toHaveBeenCalled();
    });

    // After caches are populated, the component should render the document data.
    await waitFor(() => {
      const text = container!.textContent || '';
      expect(text).toContain('My Doc');
    });
  });

  test('renders updated data after subscription callback fires', async () => {
    const mockDoc = createMockDocument({ version: 1 });
    const mockSwarm = createMockCollabswarm(mockDoc);

    let container: HTMLElement;
    await act(async () => {
      const result = render(
        React.createElement(TestProvider, null,
          React.createElement(TestConsumer, {
            collabswarm: mockSwarm,
            documentPath: '/render-update',
          }),
        ),
      );
      container = result.container;
    });

    await waitFor(() => {
      expect(mockDoc.subscribe).toHaveBeenCalled();
    });

    // Trigger subscription callback with new data.
    const handler = mockDoc.subscribe.mock.calls[0][1] as Function;
    await act(async () => {
      handler({ version: 2 }, ['reader1'], ['writer1']);
    });

    await waitFor(() => {
      const text = container!.textContent || '';
      expect(text).toContain('"version":2');
    });
  });
});
