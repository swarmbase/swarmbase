/**
 * Deterministic tip-set hash used by the initial-load quorum protocol.
 *
 * When a new node opens a document, it asks K peers in parallel for a
 * lightweight "tip advertisement" -- the responder's current view of the
 * document's tip set, summarized as a single 32-byte SHA-256 digest. The
 * loader counts how many peers returned the *same* hash and only proceeds
 * with a full document-load against a peer that participated in the
 * agreeing majority. See `load-quorum.ts` for the decision logic and
 * `CollabswarmDocument.load()` for how the gate is wired in.
 *
 * Closes the "no quorum protocol for verifying initial document state" gap
 * tracked under issue #189 §5.4 item 2 (and listed as a bullet under #186).
 *
 * The hash is deterministic across peers that share the same tip set
 * because:
 *   - the input CIDs are sorted lexicographically (the input order from
 *     `Set` iteration or array-passed order is irrelevant);
 *   - each CID is UTF-8 encoded with an explicit `\n` separator to avoid
 *     prefix-ambiguity between adjacent CIDs (`["ab", "c"]` vs
 *     `["a", "bc"]`).
 *
 * An empty tip set hashes to the SHA-256 of the empty string. This is
 * intentional: peers that have never seen any changes (founding member,
 * brand-new document) all agree on the empty-set hash, so a quorum can be
 * met cleanly in the bootstrapping case.
 */

/**
 * 32-byte SHA-256 length, used by the hash function and by callers that
 * need to validate wire-encoded tip-hash bytes.
 */
export const TIPS_HASH_LENGTH = 32;

/**
 * Compute the canonical tip-set hash for a document's set of known change
 * CIDs (typically a peer's `_hashes` field).
 *
 * @param hashes The collection of tip CIDs. Accepts either a `Set<string>`
 *   (the in-memory representation in `CollabswarmDocument._hashes`) or a
 *   plain `string[]` (more convenient for tests).
 * @returns A 32-byte `Uint8Array` containing the SHA-256 digest of the
 *   canonicalized tip set.
 */
export async function tipsHash(
  hashes: Set<string> | readonly string[],
): Promise<Uint8Array> {
  const sorted = Array.from(hashes).slice().sort();
  // Use `\n` (0x0A) as a CID separator. Real CIDs are base32/base58/base64
  // text and never contain raw `\n`, so this is unambiguous. Encoding the
  // separator (rather than concatenating bytes directly) prevents two
  // different tip sets from colliding via a shared boundary, e.g.
  // `["ab", "c"]` vs `["a", "bc"]`.
  const canonical = sorted.join('\n');
  const encoded = new TextEncoder().encode(canonical);
  // Cast required: `Uint8Array<ArrayBufferLike>` does not strictly satisfy
  // WebCrypto's `BufferSource` (excludes `SharedArrayBuffer`-backed views).
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoded as Uint8Array<ArrayBuffer>,
  );
  return new Uint8Array(digest);
}

/**
 * Encode a tips-hash byte array as a lowercase hex string. Used to key the
 * agreement map in `decideLoadQuorum` and to log/diagnose hash mismatches.
 *
 * Mirrors the canonical encoding so two callers comparing serialized hashes
 * over the wire always produce identical strings for identical inputs.
 */
export function tipsHashToHex(hash: Uint8Array): string {
  let out = '';
  for (let i = 0; i < hash.length; i++) {
    out += hash[i].toString(16).padStart(2, '0');
  }
  return out;
}
