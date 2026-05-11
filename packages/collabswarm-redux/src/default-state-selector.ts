import type { CollabswarmState } from './reducers';

/**
 * Default selector used when the collabswarm state sits at the root of the
 * Redux store (i.e. the store IS the CollabswarmState with no nesting).
 *
 * Callers whose Redux store has a nested layout must pass their own selector
 * to each *Async() action creator — this helper deliberately casts the
 * unknown root state as if it IS the collabswarm slice.
 *
 * The cast cannot be made type-safe without locking the RootStateType generic
 * to CollabswarmState, which would prevent callers from using nested stores.
 * Extracting it here removes the five identical inline casts from actions.ts
 * without changing any runtime behaviour.
 */
export function defaultStateSelector<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey,
>(
  state: unknown,
): CollabswarmState<
  DocType,
  ChangesType,
  ChangeFnType,
  PrivateKey,
  PublicKey,
  DocumentKey
> {
  return state as CollabswarmState<
    DocType,
    ChangesType,
    ChangeFnType,
    PrivateKey,
    PublicKey,
    DocumentKey
  >;
}
