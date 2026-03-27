/**
 * Builds a pubsub topic string for a given document path by prepending
 * the configured topic prefix. This separates document pubsub traffic
 * from other topics on the same network.
 *
 * The default prefix is an empty string, which means the topic is the
 * bare document path -- identical to the behavior before this helper
 * was introduced. To namespace document topics, pass a prefix such as
 * `'/document/'` via `CollabswarmConfig.pubsubDocumentPrefix`.
 *
 * @param documentPath - The path identifying the document.
 * @param topicPrefix - Prefix to prepend (defaults to `''`).
 * @returns The full pubsub topic string.
 */
export function documentTopic(
  documentPath: string,
  topicPrefix: string = '',
): string {
  // When the prefix is empty, return the path unchanged to preserve
  // backward-compatible topic strings.
  if (topicPrefix === '') {
    return documentPath;
  }
  // Avoid double slashes when both prefix ends with '/' and path starts with '/'.
  if (topicPrefix.endsWith('/') && documentPath.startsWith('/')) {
    return `${topicPrefix}${documentPath.slice(1)}`;
  }
  // Insert a separator when neither side provides one.
  if (!topicPrefix.endsWith('/') && !documentPath.startsWith('/')) {
    return `${topicPrefix}/${documentPath}`;
  }
  return `${topicPrefix}${documentPath}`;
}
