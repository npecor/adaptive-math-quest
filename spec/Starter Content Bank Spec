# Adaptive Math Quest — Starter Content Bank Spec

## Storage format
Store items in JSON (or JSONL). Include:
- id
- type: flow | puzzle
- difficulty: 700–1700
- tags: array of strings
- prompt(s)
- answer(s)
- hint ladder
- solution steps

### Flow item schema (example)
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
