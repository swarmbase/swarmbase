/**
 * Module-level caches shared by useCollabswarmDocumentState hook instances.
 *
 * Extracted into a separate internal module so that test files can reset
 * caches between tests without adding test-only exports to the public
 * hooks API surface. This module is NOT re-exported from the package
 * index.
 */

import type { CollabswarmDocument } from '@collabswarm/collabswarm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Module-level singletons must use `any` because they store results from multiple generic instantiations of useCollabswarmDocumentState.
export type CollabswarmContextOpenResultAny = {
  docRef?: CollabswarmDocument<any, any, any, any, any, any>;
  readers?: any[];
  writers?: any[];
};

export const openTasks = new Map<string, Promise<CollabswarmContextOpenResultAny>>();

export const openTaskResults = new Map<string, CollabswarmContextOpenResultAny>();

// Reference count per documentPath -- only evict shared caches when the last subscriber unmounts.
export const subscriberCounts = new Map<string, number>();

