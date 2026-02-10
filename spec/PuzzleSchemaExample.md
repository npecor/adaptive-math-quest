{
  "id": "puz_0001",
  "type": "puzzle",
  "difficulty": 1050,
  "tags": ["counting", "patterns", "reasoning"],
  "title": "Grid Paths",
  "core_prompt": "How many shortest paths are there from A to B on a 3×3 grid if you can only move right or up?",
  "core_answer": "20",
  "extensions": [
    {
      "label": "Extension 1",
      "prompt": "Now block one middle intersection. How many shortest paths remain?",
      "answer": "depends_on_block",
      "note": "Implement by choosing a blocked node and computing via DP."
    },
    {
      "label": "Extension 2",
      "prompt": "What pattern do you notice for an N×N grid? Describe it.",
      "answer": "binomial_coefficient",
      "note": "Use combinations: choose N rights among 2N moves."
    }
  ],
  "hint_ladder": [
    "Start smaller: try a 1×1 and 2×2 grid first.",
    "Make a table: ways to reach each point = left + below.",
    "This becomes a number pattern (like Pascal’s triangle).",
    "Reveal: Use combinations or DP to get 20."
  ],
  "solution_steps": [
    "Dynamic programming: each intersection gets ways = from left + from below.",
    "Fill the grid; the top-right becomes 20.",
    "This matches combinations: choose 3 rights among 6 moves → C(6,3)=20."
  ]
}
