// ============================================================
// ClickClash — OpenTDB Category List (hardcoded for Phase 2)
//
// Source: https://opentdb.com/api_category.php
// Phase 3+ could fetch this dynamically and cache it, but
// the list rarely changes so hardcoding is fine for now.
// ============================================================

export interface Category {
  id: number | null; // null = all categories
  name: string;
}

export const CATEGORIES: Category[] = [
  { id: null, name: "🎲 All Categories" },
  { id: 9,  name: "🧠 General Knowledge" },
  { id: 10, name: "📚 Books" },
  { id: 11, name: "🎬 Film" },
  { id: 12, name: "🎵 Music" },
  { id: 14, name: "📺 Television" },
  { id: 15, name: "🎮 Video Games" },
  { id: 16, name: "♟️ Board Games" },
  { id: 17, name: "🔬 Science & Nature" },
  { id: 18, name: "💻 Computers" },
  { id: 19, name: "📐 Mathematics" },
  { id: 20, name: "⚡ Mythology" },
  { id: 21, name: "⚽ Sports" },
  { id: 22, name: "🌍 Geography" },
  { id: 23, name: "📜 History" },
  { id: 25, name: "🎨 Art" },
  { id: 26, name: "⭐ Celebrities" },
  { id: 27, name: "🐾 Animals" },
  { id: 28, name: "🚗 Vehicles" },
];
