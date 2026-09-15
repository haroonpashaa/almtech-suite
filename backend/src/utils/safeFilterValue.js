// ALM-SEC-013 fix: a client-supplied query-string filter value must only ever
// be used as a literal string in a Mongo filter, never as a nested object
// (Express's `qs` parser turns `?category[$ne]=null` into `{ $ne: 'null' }`,
// which Mongo would otherwise interpret as a real query operator). Coercing
// through `String()` collapses any such object/array into a harmless literal
// that cannot match a real record — the query still runs, it just correctly
// finds nothing, exactly like any other honest nonexistent filter value.
export function safeFilterValue(v) {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v);
}
