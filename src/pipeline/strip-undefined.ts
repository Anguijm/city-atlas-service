/**
 * Recursively removes keys whose value is `undefined` from a plain object.
 * Firestore rejects undefined values at write time; Gemini research output
 * occasionally emits undefined for optional numeric fields (e.g. trending_score).
 * Explicit removal keeps the behavior auditable — required fields that go
 * undefined still surface as missing-field errors via the post-strip Zod
 * guard in enrich_ingest.ts rather than being silently swallowed.
 */
export function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, stripValue(v)])
  );
}

function stripValue(v: unknown): unknown {
  if (Array.isArray(v)) {
    // Remove undefined elements; recurse into nested arrays and objects.
    return v.filter((el) => el !== undefined).map(stripValue);
  }
  if (v !== null && typeof v === "object") {
    return stripUndefined(v as Record<string, unknown>);
  }
  return v;
}
