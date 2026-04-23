import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Audit Task 1: the `phase_a_gemini` prompt in research-city.py must explicitly
 * instruct Gemini to ignore historical / defunct places. Wikipedia and other
 * scraped sources contain prose like "The theatre was built in 1931 and was
 * demolished in 1971" — we must not turn that into a waypoint.
 *
 * This test pins the prompt text so future edits cannot silently regress the guard.
 */
describe("phase_a_gemini historical-place guard (audit Task 1)", () => {
  const source = readFileSync(
    resolve(__dirname, "..", "pipeline", "research_city.py"),
    "utf-8",
  );

  it("includes an explicit 'currently existing' instruction", () => {
    expect(source).toMatch(/currently existing.*visit|still (standing|operat)/i);
  });

  it("lists historical-prose trigger phrases Gemini should reject", () => {
    const triggers = ["was built in", "was demolished", "formerly located", "no longer"];
    const missing = triggers.filter((t) => !source.toLowerCase().includes(t.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it("the guard lives inside the phase_a_gemini prompt, not a random comment", () => {
    // Locate the prompt literal: starts at `prompt = f"""` inside phase_a_gemini.
    const match = source.match(/def phase_a_gemini[\s\S]*?prompt = f"""([\s\S]*?)"""/);
    expect(match, "phase_a_gemini prompt literal not found").not.toBeNull();
    const promptBody = match![1].toLowerCase();
    expect(promptBody).toContain("currently existing");
  });
});
