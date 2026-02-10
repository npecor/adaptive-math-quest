# Adaptive Math Quest — Content Bank Spec (MVP)

This document defines:
1) Canonical schemas for Flow and Puzzle items
2) Difficulty bands + tag taxonomy
3) Authoring rules (hints, solutions, distractors)
4) Seed content list (30 Flow items + 12 Puzzles)

The app should load actual content from JSON files (recommended):
- content/flow.seed.json
- content/puzzles.seed.json

Codex can generate these JSON files from the schemas and seed lists below.

---

## 1) Difficulty Scale (700–1700)

This scale is used for both:
- Player rating `R` (starts at 1000)
- Item difficulty `Q`

Guideline bands:
- 700–900: confident arithmetic, simple fractions, basic patterns
- 900–1100: multi-step word problems, fraction/percent comparisons, intro variables
- 1100–1300: pre-algebra reasoning, multi-constraint puzzles, geometry combos
- 1300–1500: high-ceiling extensions, generalization, strategy proofs
- 1500–1700: rare “genius mode” items (optional, not frequent)

---

## 2) Tag Taxonomy

### Core math tags
- add_sub
- mult_div
- factors_multiples
- fractions
- decimals
- percents
- ratios_rates
- negative_numbers
- prealgebra
- equations
- geometry_area
- geometry_angles
- geometry_coordinates
- probability
- measurement
- word_problem

### Puzzle / thinking tags
- patterns
- logic
- counting
- strategy
- spatial
- proof_lite
- reasoning

Notes:
- Tags should remain small and stable.
- An item can have multiple tags.

---

## 3) Hints & Solutions Authoring Rules

### Hint ladder philosophy
Hints should preserve dignity; never shame. Prefer scaffolding over giving away.

For Flow items (hints array):
- Hint 1: Nudge ("Try a common denominator.")
- Hint 2: Tool ("Use denominator 24.")
- Hint 3: Partial step ("3/8=9/24, 5/12=10/24.")
- Optional Hint 4: Reveal (but better to put reveal in solution steps)

For Puzzle items (hint_ladder array):
- Hint 1: Start smaller / simplify
- Hint 2: Suggest representation (table, diagram)
- Hint 3: Partial structure
- Hint 4: Reveal approach

### Solution steps
- 2–6 steps, kid-readable
- Include the “why” briefly when it matters

### Multiple choice distractors (Flow)
When converting seed items into MC:
- Include common mistakes:
  - reciprocal error (e.g., 2/5 vs 5/2)
  - off-by-one pattern continuation
  - distributing incorrectly (3·8+2 vs 3(8+2))
  - unit mistakes (area vs perimeter)
- Avoid trick questions that rely on reading traps.

---

## 4) Canonical JSON Schemas

### 4.1 Flow Item Schema

Flow items are fast questions designed for momentum and calibration.

**Required fields**
- id: string (unique)
- type: "flow"
- difficulty: number (700–1700)
- tags: string[]
- format: "multiple_choice" | "numeric_input" | "text_input"
- prompt: string
- answer: string (store as string for simplicity)
- hints: string[] (at least 2)
- solution_steps: string[] (at least 2)

**Optional fields**
- choices: string[] (required if multiple_choice)
- accept_answers: string[] (optional list of acceptable equivalents)
- unit: string (e.g., "degrees", "cm^2")
- image: { src: string, alt: string } (optional)
- explanation_short: string (optional)

**Example**
```json
{
  "id": "flow_0001",
  "type": "flow",
  "difficulty": 980,
  "tags": ["fractions", "number_sense"],
  "format": "multiple_choice",
  "prompt": "Which is bigger: 3/8 or 5/12?",
  "choices": ["3/8", "5/12", "same"],
  "answer": "5/12",
  "hints": [
    "Try rewriting both fractions with the same denominator.",
    "A common denominator could be 24.",
    "3/8 = 9/24 and 5/12 = 10/24."
  ],
  "solution_steps": [
    "Compare using a common denominator: 3/8 = 9/24 and 5/12 = 10/24.",
    "10/24 is bigger than 9/24, so 5/12 is bigger."
  ]
}


