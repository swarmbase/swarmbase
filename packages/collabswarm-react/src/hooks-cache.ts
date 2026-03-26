/**
 * Module-level caches shared by useCollabswarmDocumentState hook instances.
 *
 * Extracted into a separate internal module so that test files can reset
 * caches between tests without adding test-only exports to the public
 * hooks API surface. This module is NOT re-exported from the package
 * index.
 */

import type { CollabswarmDocument } from '@collabswarm/collabswarm';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type CollabswarmContextOpenResultAny = {
  docRef?: CollabswarmDocument<any, any, any, any, any, any>;
  readers?: any[];
  writers?: any[];
};

export const openTasks = new Map<string, Promise<CollabswarmContextOpenResultAny>>();
export const openTaskResults = new Map<string, CollabswarmContextOpenResultAny>();
export const subscriberCounts = new Map<string, number>();
/* eslint-enable @typescript-eslint/no-explicit-any */

