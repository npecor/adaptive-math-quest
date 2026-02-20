import { generateAdaptivePuzzleItem } from '../src/lib/puzzle-generator';

type AnyPuzzle = {
  id: string;
  title: string;
  core_prompt: string;
  core_answer: string;
  hint_ladder: string[];
  solution_steps: string[];
  difficulty: number;
  template?: string;
};

const hasDecimal = (s: string) => /\d+\.\d+/.test(s);

function scanDecimals(p: AnyPuzzle): string[] {
  const problems: string[] = [];
  const fields: Array<[string, unknown]> = [
    ['title', p.title],
    ['core_prompt', p.core_prompt],
    ['core_answer', p.core_answer],
    ['hint_ladder', p.hint_ladder],
    ['solution_steps', p.solution_steps]
  ];
  for (const [k, v] of fields) {
    if (typeof v === 'string' && hasDecimal(v)) problems.push(`${k}: ${v}`);
    if (Array.isArray(v)) {
      for (const entry of v) {
        if (typeof entry === 'string' && hasDecimal(entry)) problems.push(`${k}[]: ${entry}`);
      }
    }
  }
  return problems;
}

function inferTemplate(p: AnyPuzzle): string {
  if (p.template) return p.template;
  const id = String(p.id ?? '');
  return id.split('-')[0] || 'unknown';
}

function extractStarsN(p: AnyPuzzle): number | null {
  const id = String(p.id ?? '');
  const m = id.match(/^stars-(\d+)/);
  return m ? Number(m[1]) : null;
}

function expectedStarsAnswer(n: number): 'yes' | 'no' {
  return n % 4 === 0 ? 'no' : 'yes';
}

async function run(rating: number) {
  const N = 8000;
  const used = new Set<string>();
  let prevDifficulty: number | undefined;

  const counts: Record<string, number> = {};
  const decimals: string[] = [];
  let areaYes = 0;
  let areaNo = 0;
  let starsChecked = 0;
  let starsBad = 0;

  for (let i = 0; i < N; i += 1) {
    const p: AnyPuzzle = generateAdaptivePuzzleItem(rating, used, prevDifficulty) as AnyPuzzle;
    const t = inferTemplate(p);
    counts[t] = (counts[t] ?? 0) + 1;

    const dec = scanDecimals(p);
    if (dec.length) decimals.push(`${p.id}: ${dec.join(' | ')}`);

    if (t === 'area_yn') {
      const ans = String(p.core_answer ?? '').toLowerCase();
      if (ans === 'yes') areaYes += 1;
      else if (ans === 'no') areaNo += 1;
    }

    if (t === 'stars') {
      const n = extractStarsN(p);
      if (n != null) {
        starsChecked += 1;
        const actual = String(p.core_answer ?? '').toLowerCase();
        const expected = expectedStarsAnswer(n);
        if (actual !== expected) starsBad += 1;
      }
    }

    prevDifficulty = p.difficulty;
    used.add(String(p.id));
    if (i % 10 === 0) used.clear();
  }

  console.log(`\n=== Puzzle verify @ rating ${rating} (${N} picks) ===`);
  console.log(
    'Template frequency:',
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${((v / N) * 100).toFixed(2)}%`)
      .join(', ')
  );

  console.log(`area_yn split: Yes=${areaYes}, No=${areaNo}`);
  if (areaYes === 0 || areaNo === 0) {
    console.error('ERROR: area_yn needs both Yes and No outcomes.');
    process.exitCode = 1;
  }

  if (starsChecked > 0) {
    console.log(`stars rule: checked=${starsChecked}, bad=${starsBad}`);
    if (starsBad > 0) {
      console.error('ERROR: some stars puzzles violate the n%4 answer rule.');
      process.exitCode = 1;
    }
  } else {
    console.log('stars rule: no stars puzzles generated (check template ranges/inference).');
    process.exitCode = 1;
  }

  if (decimals.length) {
    console.error(`Found decimals (${decimals.length} examples). First 10:\n${decimals.slice(0, 10).join('\n')}`);
    process.exitCode = 1;
  }
}

(async () => {
  await run(1050);
  await run(1250);
  await run(1450);
})();
