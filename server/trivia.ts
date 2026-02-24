// ============================================================
// ClickClash — Open Trivia DB Integration
//
// Fetches 10 multiple-choice questions, decodes HTML entities,
// shuffles answer options, and converts to internal format.
//
// API docs: https://opentdb.com/api_config.php
// ============================================================

import type { Question } from "./types";

const OPENTDB_URL = "https://opentdb.com/api.php";

// ---- Raw API shapes ----

interface OpenTDBQuestion {
  category: string;
  type: string;
  difficulty: string;
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
}

interface OpenTDBResponse {
  response_code: number;
  results: OpenTDBQuestion[];
}

// ---- HTML entity decode (no external deps) ----
// OpenTDB returns HTML-encoded strings. We decode them server-side so
// clients receive clean text. Handles numeric and named entities.

function decodeHTML(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&hellip;/g, "\u2026")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&deg;/g, "\u00B0")
    .replace(/&frac12;/g, "\u00BD")
    .replace(/&times;/g, "\u00D7")
    .replace(/&divide;/g, "\u00F7")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 10))
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

// ---- Fisher-Yates shuffle ----

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- OpenTDB response_code meanings ----
// 0 = Success
// 1 = No Results (category doesn't have enough questions)
// 2 = Invalid Parameter
// 3 = Token Not Found
// 4 = Token Empty
// 5 = Rate Limit (Too many requests; ~5s cooldown required)

const ERROR_MESSAGES: Record<number, string> = {
  1: "Not enough questions for this category. Try a different one or use All Categories.",
  2: "Invalid category. Please refresh and try again.",
  5: "OpenTDB rate limit hit. Please wait a few seconds and try again.",
};

/**
 * Fetch 10 multiple-choice questions from Open Trivia DB.
 *
 * @param categoryId  OpenTDB category id, or null for "all categories"
 * @param gameId      Used as a prefix for question ids to guarantee
 *                    uniqueness across games.
 */
export async function fetchQuestions(
  categoryId: number | null,
  gameId: string
): Promise<Question[]> {
  const url = new URL(OPENTDB_URL);
  url.searchParams.set("amount", "10");
  url.searchParams.set("type", "multiple");
  if (categoryId !== null) {
    url.searchParams.set("category", String(categoryId));
  }

  console.log(`[trivia] fetching questions — gameId=${gameId} category=${categoryId ?? "all"}`);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`OpenTDB HTTP error: ${res.status} ${res.statusText}`);
  }

  const data: OpenTDBResponse = await res.json();

  if (data.response_code !== 0) {
    const msg =
      ERROR_MESSAGES[data.response_code] ??
      `OpenTDB returned response_code ${data.response_code}`;
    throw new Error(msg);
  }

  console.log(`[trivia] received ${data.results.length} questions`);

  return data.results.map((q, i): Question => {
    const correct = decodeHTML(q.correct_answer);
    const options = shuffle([correct, ...q.incorrect_answers.map(decodeHTML)]);

    return {
      id: `${gameId}-q${i}`,
      text: decodeHTML(q.question),
      options,
      correct,
      category: decodeHTML(q.category),
      difficulty: q.difficulty,
    };
  });
}
