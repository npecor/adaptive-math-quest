import { generateAdaptiveFlowItem } from '../src/lib/flow-generator';

type AnyFlow = {
  id: string;
  template?: string;
  shapeSignature?: string;
  tier?: string;
  difficulty: number;
  prompt: string;
  answer: string;
  choices?: string[];
  hints: string[];
  solution_steps: string[];
};

const TIERS = [
  { name: 'Rookie', rating: 810 },
  { name: 'Easy', rating: 850 },
  { name: 'Medium', rating: 975 },
  { name: 'Hard', rating: 1125 },
  { name: 'Expert', rating: 1275 },
  { name: 'Master', rating: 1425 }
];

const hasDecimal = (s: string) => /\d+\.\d+/.test(s);

function scanForDecimals(item: AnyFlow): string[] {
  const problems: string[] = [];
  const fields: Array<[string, unknown]> = [
    ['prompt', item.prompt],
    ['answer', item.answer],
    ['choices', item.choices],
    ['hints', item.hints],
    ['solution_steps', item.solution_steps]
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

function parseAddSub(prompt: string): { a: number; b: number; op: '+' | '-' } | null {
  const m = prompt.match(/^\s*(\d+)\s*([+-])\s*(\d+)\s*=\s*\?\s*$/);
  if (!m) return null;
  return { a: Number(m[1]), op: m[2] as '+' | '-', b: Number(m[3]) };
}

function isTrivial(item: AnyFlow): boolean {
  const p = String(item.prompt ?? '');
  const mm = p.match(/^\s*(\d+)\s*[×x]\s*(\d+)\s*=\s*\?\s*$/);
  if (mm) return Number(mm[1]) <= 9 && Number(mm[2]) <= 9;

  const dm = p.match(/^\s*(\d+)\s*÷\s*(\d+)\s*=\s*\?\s*$/);
  if (dm) return Number(dm[1]) <= 100 && Number(dm[2]) <= 12;

  const emAdd = p.match(/^\s*x\s*\+\s*(\d+)\s*=\s*(\d+)\s*$/);
  if (emAdd) return Number(emAdd[1]) <= 12 && Number(emAdd[2]) <= 30;

  const emMul = p.match(/^\s*(\d+)x\s*=\s*(\d+)\s*$/);
  if (emMul) return Number(emMul[1]) <= 4 && Number(emMul[2]) <= 40;

  return false;
}

function inferTemplate(item: AnyFlow): string {
  if (item.template) return item.template;
  const id = String(item.id ?? '');
  return id.split('-')[0] || 'unknown';
}

function inferLabel(item: AnyFlow): string {
  if (item.tier) return item.tier;
  const d = item.difficulty;
  if (d >= 1350) return 'Master';
  if (d >= 1200) return 'Expert';
  if (d >= 1050) return 'Hard';
  if (d >= 900) return 'Medium';
  if (d >= 850) return 'Easy';
  return 'Rookie';
}

function inferGeomShape(item: AnyFlow): string | null {
  const p = String(item.prompt ?? '').toLowerCase();
  if (!p.includes('rectangle') && !p.includes('triangle')) return null;
  if (p.includes('perimeter')) return 'geom_rect_perim';
  if (p.includes('rectangle') && p.includes('area')) return 'geom_rect_area';
  if (p.includes('triangle') && p.includes('area')) return 'geom_tri_area';
  return 'geom_unknown';
}

async function runTier(name: string, rating: number) {
  const N = 20000;
  const counts: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  const templateLabelCounts: Record<string, number> = {};
  const decimals: string[] = [];
  let negativeSub = 0;
  let subCount = 0;
  let trivialCount = 0;
  let hardCount = 0;

  const geomCounts: Record<string, number> = {};
  let geomOnlySamples = 0;

  const used = new Set<string>();
  let prevDifficulty: number | undefined;
  let recentTemplates: string[] = [];
  let recentShapes: string[] = [];

  for (let i = 0; i < N; i += 1) {
    const q: AnyFlow = generateAdaptiveFlowItem(rating, used, prevDifficulty, recentTemplates, recentShapes) as AnyFlow;
    const t = inferTemplate(q);
    const label = inferLabel(q);
    counts[t] = (counts[t] ?? 0) + 1;
    labelCounts[label] = (labelCounts[label] ?? 0) + 1;
    templateLabelCounts[`${t}|${label}`] = (templateLabelCounts[`${t}|${label}`] ?? 0) + 1;

    const dec = scanForDecimals(q);
    if (dec.length) decimals.push(`${q.id}: ${dec.join(' | ')}`);

    const parsed = parseAddSub(String(q.prompt ?? ''));
    if (parsed && parsed.op === '-') {
      subCount += 1;
      const ans = Number(q.answer);
      if (ans < 0) negativeSub += 1;
    }

    if (rating >= 1125) {
      hardCount += 1;
      if (isTrivial(q)) trivialCount += 1;
    }

    if (!Array.isArray(q.hints) || q.hints.length !== 3) {
      throw new Error(`Hints not 3-step for ${q.id} (${t}): ${JSON.stringify(q.hints)}`);
    }

    if (rating >= 1275) {
      const shape = q.shapeSignature ?? inferGeomShape(q);
      if (shape) {
        geomCounts[String(shape)] = (geomCounts[String(shape)] ?? 0) + 1;
        geomOnlySamples += 1;
      }
    }

    prevDifficulty = q.difficulty;
    const shapeSig = q.shapeSignature ?? inferGeomShape(q) ?? 'none';
    recentTemplates = [...recentTemplates, t].slice(-6);
    recentShapes = [...recentShapes, String(shapeSig)].slice(-6);
    used.add(String(q.id));
    if (i % 10 === 0) used.clear();
  }

  console.log(`\n=== ${name} (rating ${rating}) ===`);
  const freq = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${(v / N * 100).toFixed(2)}%`);
  console.log('Template frequency:', freq.join(', '));
  const labelFreq = Object.entries(labelCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${(v / N * 100).toFixed(2)}%`);
  console.log('Label frequency:', labelFreq.join(', '));
  const comboFreq = Object.entries(templateLabelCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${(v / N * 100).toFixed(2)}%`);
  console.log('Template+Label frequency:', comboFreq.slice(0, 18).join(', '));
  console.log(`Negative subtraction rate: ${(subCount ? (negativeSub / subCount) * 100 : 0).toFixed(2)}% (${negativeSub}/${subCount})`);

  if (hardCount) {
    console.log(`Trivial rate (Hard+): ${((trivialCount / hardCount) * 100).toFixed(2)}% (${trivialCount}/${hardCount})`);
    if (trivialCount > 0) process.exitCode = 1;
  }

  if (rating >= 1275) {
    console.log('Geometry subtype counts:', geomCounts, 'samples:', geomOnlySamples);
    const required = ['geom_rect_area', 'geom_rect_perim', 'geom_tri_area'];
    for (const shape of required) {
      if (!geomCounts[shape]) {
        console.error(`Missing geometry subtype at ${name}: ${shape}`);
        process.exitCode = 1;
      }
    }
  }

  if ((rating === 810 || rating === 850) && negativeSub > 0) {
    console.error('Rookie/Easy tier has negative subtraction answers.');
    process.exitCode = 1;
  }

  if (decimals.length) {
    console.error(`Found decimals (${decimals.length} examples). First 10:\n${decimals.slice(0, 10).join('\n')}`);
    process.exitCode = 1;
  }
}

async function printSamples() {
  console.log('\n=== 30 Samples Per Tier ===');
  for (const tier of TIERS) {
    const used = new Set<string>();
    let prevDifficulty: number | undefined;
    let recentTemplates: string[] = [];
    let recentShapes: string[] = [];
    console.log(`\n## ${tier.name}`);

    for (let i = 0; i < 30; i += 1) {
      const q: AnyFlow = generateAdaptiveFlowItem(tier.rating, used, prevDifficulty, recentTemplates, recentShapes) as AnyFlow;
      const t = inferTemplate(q);
      const label = inferLabel(q);
      const shape = q.shapeSignature ?? inferGeomShape(q) ?? '';
      console.log(`${String(i + 1).padStart(2, '0')}. [${label} | ${t}${shape ? ` / ${shape}` : ''} | d=${q.difficulty}] ${q.prompt}`);
      used.add(String(q.id));
      prevDifficulty = q.difficulty;
      recentTemplates = [...recentTemplates, t].slice(-6);
      recentShapes = [...recentShapes, String(shape || 'none')].slice(-6);
    }
  }
}

(async () => {
  for (const tier of TIERS) {
    await runTier(tier.name, tier.rating);
  }
  await printSamples();
})();
