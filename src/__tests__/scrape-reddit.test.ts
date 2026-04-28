import { describe, it, expect } from "vitest";

type RedditCity = {
  id: string;
  name: string;
  country: string;
  region?: string;
  coverageTier?: string;
};

// Metro floor — unchanged from historical default, used in assertions below.
const METRO_FLOOR = 500;

describe("scrape-reddit logic", () => {
  describe("buildSubredditCandidates", () => {
    it("starts with the lowercased city id", async () => {
      const { buildSubredditCandidates } = await import("../scrapers/reddit");
      const city: RedditCity = { id: "bend", name: "Bend", country: "United States" };
      const subs = buildSubredditCandidates(city);
      expect(subs[0]).toBe("bend");
    });

    it("normalizes hyphenated ids to underscored / concatenated variants", async () => {
      const { buildSubredditCandidates } = await import("../scrapers/reddit");
      const city: RedditCity = { id: "traverse-city", name: "Traverse City", country: "United States" };
      const subs = buildSubredditCandidates(city);
      expect(subs).toContain("traversecity");
      expect(subs).toContain("TraverseCity");
    });

    it("appends /r/travel as the last-resort fallback", async () => {
      const { buildSubredditCandidates } = await import("../scrapers/reddit");
      const city: RedditCity = { id: "marfa", name: "Marfa", country: "United States" };
      const subs = buildSubredditCandidates(city);
      expect(subs[subs.length - 1]).toBe("travel");
    });

    it("returns deduped candidates", async () => {
      const { buildSubredditCandidates } = await import("../scrapers/reddit");
      const city: RedditCity = { id: "bend", name: "Bend", country: "United States" };
      const subs = buildSubredditCandidates(city);
      expect(new Set(subs).size).toBe(subs.length);
    });
  });

  describe("extractPostsFromSearchJson", () => {
    const fixture = {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t3",
            data: {
              title: "Hidden gems in Akron?",
              selftext: "I'm visiting next weekend — where should I eat?",
              subreddit: "akron",
              author: "wanderer42",
              score: 87,
              url: "https://reddit.com/r/akron/comments/abc/hidden_gems/",
              permalink: "/r/akron/comments/abc/hidden_gems/",
              id: "abc",
              over_18: false,
              stickied: false,
            },
          },
          {
            kind: "t3",
            data: {
              title: "Removed",
              selftext: "[removed]",
              subreddit: "akron",
              author: "[deleted]",
              score: 0,
              url: "",
              permalink: "/r/akron/comments/def/removed/",
              id: "def",
              over_18: false,
              stickied: false,
            },
          },
          {
            kind: "t3",
            data: {
              title: "NSFW party",
              selftext: "…",
              subreddit: "akron",
              author: "user",
              score: 12,
              url: "",
              permalink: "/r/akron/comments/ghi/nsfw/",
              id: "ghi",
              over_18: true,
              stickied: false,
            },
          },
          {
            kind: "t3",
            data: {
              title: "Welcome to r/akron — read before posting",
              selftext: "Sticky rules and FAQ.",
              subreddit: "akron",
              author: "mod_user",
              score: 200,
              url: "",
              permalink: "/r/akron/comments/jkl/welcome/",
              id: "jkl",
              over_18: false,
              stickied: true,
            },
          },
          {
            kind: "t3",
            data: {
              title: "Best pizza in Akron?",
              // selftext missing entirely — link post
              subreddit: "akron",
              author: "pizza_dad",
              score: 45,
              url: "https://example.com/pizza",
              permalink: "/r/akron/comments/mno/best_pizza/",
              id: "mno",
              over_18: false,
              stickied: false,
            },
          },
        ],
      },
    };

    it("extracts non-removed, non-NSFW, non-stickied posts", async () => {
      const { extractPostsFromSearchJson } = await import("../scrapers/reddit");
      const posts = extractPostsFromSearchJson(fixture);
      const ids = posts.map((p) => p.id);
      expect(ids).toContain("abc");
      expect(ids).toContain("mno");
      expect(ids).not.toContain("def"); // [removed]
      expect(ids).not.toContain("ghi"); // NSFW
      expect(ids).not.toContain("jkl"); // stickied mod post
    });

    it("preserves link posts (selftext missing) without throwing, defaulting selftext to ''", async () => {
      const { extractPostsFromSearchJson } = await import("../scrapers/reddit");
      const posts = extractPostsFromSearchJson(fixture);
      const linkPost = posts.find((p) => p.id === "mno");
      expect(linkPost).toBeDefined();
      expect(linkPost!.selftext).toBe("");
      expect(linkPost!.title).toBe("Best pizza in Akron?");
    });

    it("returns empty array on malformed input rather than throwing", async () => {
      const { extractPostsFromSearchJson } = await import("../scrapers/reddit");
      expect(extractPostsFromSearchJson(null)).toEqual([]);
      expect(extractPostsFromSearchJson({})).toEqual([]);
      expect(extractPostsFromSearchJson({ data: {} })).toEqual([]);
    });
  });

  describe("extractCommentsFromThreadJson", () => {
    // Reddit comment endpoint returns a 2-element array:
    //   [post_listing, comments_listing]
    const fixture = [
      { data: { children: [] } },
      {
        data: {
          children: [
            {
              kind: "t1",
              data: {
                author: "local_foodie",
                body: "Try The Gem at 5pm — best burger in town.",
                score: 42,
              },
            },
            {
              kind: "t1",
              data: {
                author: "[deleted]",
                body: "[deleted]",
                score: 1,
              },
            },
            {
              kind: "t1",
              data: {
                author: "lowscore",
                body: "eh not really",
                score: 1,
              },
            },
            {
              kind: "more",
              data: { count: 5 },
            },
          ],
        },
      },
    ];

    it("returns top-scoring comments above the minScore threshold", async () => {
      const { extractCommentsFromThreadJson } = await import("../scrapers/reddit");
      const comments = extractCommentsFromThreadJson(fixture, 5);
      expect(comments.length).toBe(1);
      expect(comments[0].body).toContain("The Gem");
      expect(comments[0].score).toBe(42);
    });

    it("filters out deleted/removed comments and 'more' stubs", async () => {
      const { extractCommentsFromThreadJson } = await import("../scrapers/reddit");
      const comments = extractCommentsFromThreadJson(fixture, 0);
      expect(comments.every((c) => c.body !== "[deleted]")).toBe(true);
      expect(comments.every((c) => c.author !== "[deleted]")).toBe(true);
    });

    it("handles malformed payload without throwing", async () => {
      const { extractCommentsFromThreadJson } = await import("../scrapers/reddit");
      expect(extractCommentsFromThreadJson(null)).toEqual([]);
      expect(extractCommentsFromThreadJson([])).toEqual([]);
      expect(extractCommentsFromThreadJson([{}])).toEqual([]);
    });
  });

  describe("passesQualityGate (tightened per audit Task 2)", () => {
    // Gate rule: at least one post where
    //   (city name in TITLE) OR (city name in SELFTEXT AND >= 1 comment with score >= 5)
    // Rationale: title-mention is a strong relevance signal on its own.
    // Selftext-only mentions must be corroborated by an upvoted comment to avoid
    // noise from /r/travel round-ups that name the city in passing.
    it("passes when a post mentions the city in its title", async () => {
      const { passesQualityGate } = await import("../scrapers/reddit");
      const posts = [{ title: "Weekend in Marfa", selftext: "", comments: [] }];
      expect(passesQualityGate(posts, "Marfa")).toBe(true);
    });

    it("passes when selftext mentions the city AND at least one comment is upvoted (score >= 5)", async () => {
      const { passesQualityGate } = await import("../scrapers/reddit");
      const posts = [
        {
          title: "Road trip planning",
          selftext: "Stopping in Marfa on the way.",
          comments: [{ body: "Stop at The Capri", score: 12 }],
        },
      ];
      expect(passesQualityGate(posts, "Marfa")).toBe(true);
    });

    it("FAILS when the city is only mentioned in comments (title + selftext clean)", async () => {
      const { passesQualityGate } = await import("../scrapers/reddit");
      const posts = [
        {
          title: "best of west texas",
          selftext: "generic",
          comments: [{ body: "don't skip Marfa", score: 20 }],
        },
      ];
      expect(passesQualityGate(posts, "Marfa")).toBe(false);
    });

    it("FAILS when selftext mentions the city but no comment has score >= 5", async () => {
      const { passesQualityGate } = await import("../scrapers/reddit");
      const posts = [
        {
          title: "travel q",
          selftext: "Thinking about Marfa next spring.",
          comments: [{ body: "cool", score: 1 }, { body: "nice", score: 2 }],
        },
      ];
      expect(passesQualityGate(posts, "Marfa")).toBe(false);
    });

    it("FAILS when zero posts mention the city name in title or selftext", async () => {
      const { passesQualityGate } = await import("../scrapers/reddit");
      const posts = [{ title: "generic", selftext: "unrelated", comments: [{ body: "nope", score: 10 }] }];
      expect(passesQualityGate(posts, "Marfa")).toBe(false);
    });

    it("is case-insensitive on title match", async () => {
      const { passesQualityGate } = await import("../scrapers/reddit");
      const posts = [{ title: "TRAVERSE CITY recs", selftext: "", comments: [] }];
      expect(passesQualityGate(posts, "Traverse City")).toBe(true);
    });

    it("fails on empty posts list", async () => {
      const { passesQualityGate } = await import("../scrapers/reddit");
      expect(passesQualityGate([], "Marfa")).toBe(false);
    });

    it("village: passes on selftext-only mention with NO upvoted comment (corroboration waived)", async () => {
      const { passesQualityGate } = await import("../scrapers/reddit");
      const posts = [
        {
          title: "tiny towns of west texas",
          selftext: "Marfa is worth a detour.",
          comments: [{ body: "cool", score: 1 }],
        },
      ];
      expect(passesQualityGate(posts, "Marfa", "village")).toBe(true);
    });

    it("non-village: still requires upvoted comment for selftext-only mention", async () => {
      const { passesQualityGate } = await import("../scrapers/reddit");
      const posts = [
        {
          title: "road trip ideas",
          selftext: "Marfa is on my list.",
          comments: [{ body: "meh", score: 2 }],
        },
      ];
      expect(passesQualityGate(posts, "Marfa", "town")).toBe(false);
      expect(passesQualityGate(posts, "Marfa", "metro")).toBe(false);
      expect(passesQualityGate(posts, "Marfa")).toBe(false);
    });
  });

  describe("minMarkdownLength (tiered quality gate)", () => {
    it("returns 500 for metro", async () => {
      const { minMarkdownLength } = await import("../scrapers/reddit");
      expect(minMarkdownLength("metro")).toBe(500);
    });

    it("returns 300 for town", async () => {
      const { minMarkdownLength } = await import("../scrapers/reddit");
      expect(minMarkdownLength("town")).toBe(300);
    });

    it("returns 150 for village", async () => {
      const { minMarkdownLength } = await import("../scrapers/reddit");
      expect(minMarkdownLength("village")).toBe(150);
    });

    it("returns 500 (metro default) when coverageTier is undefined", async () => {
      const { minMarkdownLength } = await import("../scrapers/reddit");
      expect(minMarkdownLength(undefined)).toBe(500);
    });

    it("returns 500 for unknown tier (safe fallback)", async () => {
      const { minMarkdownLength } = await import("../scrapers/reddit");
      expect(minMarkdownLength("unknown-tier")).toBe(500);
    });
  });

  describe("buildMarkdown", () => {
    it("emits city heading, sub label, and per-post sections with top comments", async () => {
      const { buildMarkdown } = await import("../scrapers/reddit");
      const city: RedditCity = { id: "bend", name: "Bend", country: "United States" };
      const md = buildMarkdown(city, "bend", [
        {
          title: "Best breakfast in Bend",
          selftext: "Visiting from out of town. " + "x".repeat(200),
          subreddit: "bend",
          author: "food_nerd",
          score: 50,
          url: "https://reddit.com/r/bend/comments/1/best_breakfast/",
          permalink: "/r/bend/comments/1/best_breakfast/",
          id: "1",
          comments: [
            { author: "local1", body: "Chow downtown, hands down.", score: 20 },
            { author: "local2", body: "Jackson's Corner if you want a line.", score: 15 },
          ],
        },
      ]);
      expect(md).toMatch(/^# Reddit: Bend, United States/);
      expect(md).toMatch(/Sources: \/r\/bend/);
      expect(md).toMatch(/## Best breakfast in Bend/);
      expect(md).toMatch(/Chow downtown/);
      expect(md).toMatch(/u\/local1/);
    });

    it(`output is > METRO_FLOOR (${METRO_FLOOR}) for typical multi-comment post`, async () => {
      const { buildMarkdown } = await import("../scrapers/reddit");
      const city: RedditCity = { id: "bend", name: "Bend", country: "United States" };
      const md = buildMarkdown(city, "bend", [
        {
          title: "T",
          selftext: "x".repeat(500),
          subreddit: "bend",
          author: "a",
          score: 1,
          url: "",
          permalink: "",
          id: "1",
          comments: [{ author: "b", body: "y".repeat(200), score: 10 }],
        },
      ]);
      expect(md.length).toBeGreaterThan(METRO_FLOOR);
    });
  });

  describe("buildStubJson", () => {
    it("matches the safe schema from audit Task 3", async () => {
      const { buildStubJson } = await import("../scrapers/reddit");
      const city: RedditCity = { id: "bend", name: "Bend", country: "United States" };
      const stub = buildStubJson(city, "reddit", 0) as Record<string, unknown>;
      expect(stub.source).toBe("reddit");
      expect(stub.cityId).toBe("bend");
      expect(typeof stub.retrievedAt).toBe("string");
      expect(stub.placeCount).toBe(0);
      expect(stub.places).toBeUndefined();
    });
  });

  describe("retryWithBackoff", () => {
    it("retries transient errors then succeeds", async () => {
      const { retryWithBackoff } = await import("../scrapers/reddit");
      let calls = 0;
      const r = await retryWithBackoff(
        async () => {
          calls++;
          if (calls < 2) throw new Error("429");
          return 99;
        },
        { maxAttempts: 3, baseMs: 1 },
      );
      expect(r).toBe(99);
    });
  });
});
