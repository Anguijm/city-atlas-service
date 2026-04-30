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
      .map(([k, v]) =>
        v !== null && typeof v === "object" && !Array.isArray(v)
          ? [k, stripUndefined(v as Record<string, unknown>)]
          : [k, v]
      )
  );
}
