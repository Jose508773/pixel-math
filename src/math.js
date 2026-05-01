// math.js — generates math problems scaled by stage and difficulty
// Designed for kids learning math: lots of variety, never producing negative
// or absurd answers, with optional friendlier problem types at low difficulty.

/**
 * Returns a random integer in [min, max] inclusive.
 * Why: most generators below want integer ranges and we want one-stop helper.
 */
function randInt(min, max) {
  // Math.random() returns [0, 1); scale to range size + 1 for inclusive max,
  // floor it, then shift up by min so the lowest possible value is `min`.
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Picks a random element from an array.
 * Why: clearer than typing the index expression repeatedly in generators.
 */
function pick(arr) {
  // Use random index in [0, arr.length-1] to choose one element.
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Rounds a number to one decimal place.
 * Why: fraction problems display ".5" answers — keep them tidy and comparable.
 */
function oneDecimal(value) {
  // Multiply by 10, round to integer, divide back to lock to 1 decimal place.
  return Math.round(value * 10) / 10;
}

// ─── Problem generators ─────────────────────────────────────────────────────
// Each returns { prompt, answer, type } so the UI can render and check uniformly.

function makeAddition(scale) {
  // Easy adds for low scale; range grows with stage so older runs feel harder.
  const a = randInt(1, 8 + scale * 3);
  const b = randInt(1, 8 + scale * 3);
  return { prompt: `${a} + ${b}`, answer: a + b, type: "addition" };
}

function makeSubtraction(scale) {
  // Pick `a` first, then choose `b` <= a-1 to guarantee a positive answer.
  // Why: kids get confused/discouraged by negative results in early stages.
  const a = randInt(4 + scale, 14 + scale * 4);
  const b = randInt(1, a - 1);
  return { prompt: `${a} - ${b}`, answer: a - b, type: "subtraction" };
}

function makeMultiplication(scale) {
  // Keep one factor small (times tables 2–6) so kids can recognise patterns.
  const a = randInt(2, 5 + scale);
  const b = randInt(2, 6 + scale);
  return { prompt: `${a} × ${b}`, answer: a * b, type: "multiplication" };
}

function makeDivision(scale) {
  // Build the dividend from divisor × answer so division is always exact.
  const divisor = randInt(2, 4 + scale);
  const answer = randInt(2, 5 + scale);
  return { prompt: `${divisor * answer} ÷ ${divisor}`, answer, type: "division" };
}

function makeFraction(scale) {
  // Mixed-number-style fraction; keep denominator small (2–4) for clarity.
  const denominator = randInt(2, 4 + Math.min(scale, 4));
  const numerator = denominator * randInt(1, 2 + scale) + randInt(1, denominator - 1);
  return {
    prompt: `${numerator} ÷ ${denominator} (1 decimal)`,
    answer: oneDecimal(numerator / denominator),
    type: "fraction",
  };
}

function makeExponent(scale) {
  // Squares/cubes only — keeps numbers within a kid's mental ballpark.
  const base = randInt(2, 3 + Math.min(scale, 3));
  const exponent = randInt(2, 3);
  return { prompt: `${base}^${exponent}`, answer: base ** exponent, type: "exponent" };
}

function makeAlgebra(scale) {
  // Solve for x in form `cx + k = total`. We pre-pick x to keep it whole.
  const x = randInt(2, 8 + scale);
  const coefficient = randInt(2, 5);
  const constant = randInt(1, 6 + scale);
  const total = coefficient * x + constant;
  return { prompt: `${coefficient}x + ${constant} = ${total}`, answer: x, type: "algebra" };
}

function makeBossMultiStep(scale) {
  // Two-step (a × b) + c — builds order-of-operations habit for boss fights.
  const a = randInt(2, 4 + scale);
  const b = randInt(2, 5 + scale);
  const c = randInt(3, 8 + scale);
  return { prompt: `(${a} × ${b}) + ${c}`, answer: a * b + c, type: "boss" };
}

// ─── Kid-friendly extras ────────────────────────────────────────────────────

function makeDoubles(scale) {
  // Doubles like 6+6 are foundational facts kids memorise early.
  const a = randInt(2, 9 + scale);
  return { prompt: `${a} + ${a}`, answer: a * 2, type: "doubles" };
}

function makeNumberBond(scale) {
  // Number bonds: ? + b = total. Strengthens addition/subtraction reciprocity.
  const total = randInt(5, 10 + scale * 2);
  const b = randInt(1, total - 1);
  return { prompt: `? + ${b} = ${total}`, answer: total - b, type: "bond" };
}

function makeMissingOperand(scale) {
  // a + ? = total with positive ? — same idea, different phrasing.
  const a = randInt(1, 8 + scale);
  const missing = randInt(1, 8 + scale);
  return { prompt: `${a} + ? = ${a + missing}`, answer: missing, type: "missing" };
}

function makeMoney(scale) {
  // Coin sums in cents — concrete, real-world money math.
  const coins = [5, 10, 25];
  const a = pick(coins);
  const b = pick(coins);
  return { prompt: `${a}¢ + ${b}¢`, answer: a + b, type: "money" };
}

function makeTime(scale) {
  // "X minutes after Y o'clock" — also a number-bond skill in disguise.
  const hour = randInt(1, 11);
  const mins = randInt(5, 55);
  return {
    prompt: `If it's ${hour}:00, what hour after ${mins + 60} more minutes? (hour only)`,
    answer: ((hour + Math.floor((mins + 60) / 60)) % 12) || 12,
    type: "time",
  };
}

function makeRounding(scale) {
  // Round to nearest 10 — early estimation skill.
  const n = randInt(11, 89 + scale * 10);
  return { prompt: `Round ${n} to nearest 10`, answer: Math.round(n / 10) * 10, type: "rounding" };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a math problem for the current stage and player.
 * @param {number} stage         — encounterIndex + player.level (drives ramp).
 * @param {number} bias          — enemy-specific extra difficulty (0–3).
 * @param {boolean} simplified   — if a "Hint" was cast, restrict to easy types.
 * @param {boolean} boss         — if true, allow multi-step boss problems.
 * @param {string} difficulty    — "easy" | "normal" | "hard"; widens/narrows pool.
 */
export function generateProblem(stage, bias = 0, simplified = false, boss = false, difficulty = "normal") {
  // Effective stage gates which problem types unlock; never let it drop below 1.
  const effectiveStage = Math.max(1, stage + bias);
  const pool = [];

  // ALWAYS include the friendly basics — they're the warm bedrock for kids.
  pool.push(makeAddition(effectiveStage), makeSubtraction(effectiveStage));

  // On easy mode, lean into kid-friendly bonds and doubles even at low stages.
  if (difficulty === "easy") {
    pool.push(makeDoubles(effectiveStage), makeNumberBond(effectiveStage), makeMissingOperand(effectiveStage));
  }

  // Beyond stage 2, multiplication and division open up.
  if (!simplified && effectiveStage >= 2) {
    pool.push(makeMultiplication(effectiveStage), makeDivision(effectiveStage));
    if (difficulty !== "hard") pool.push(makeDoubles(effectiveStage));
    if (difficulty !== "hard") pool.push(makeMoney(effectiveStage));
  }

  // Mid-game adds fractions, exponents, and rounding estimation.
  if (!simplified && effectiveStage >= 4) {
    pool.push(makeFraction(effectiveStage), makeExponent(effectiveStage));
    pool.push(makeRounding(effectiveStage));
    if (difficulty !== "hard") pool.push(makeMissingOperand(effectiveStage));
    pool.push(makeTime(effectiveStage));
  }

  // Late game: simple algebra. Hard mode adds it earlier.
  const algebraStage = difficulty === "hard" ? 5 : 6;
  if (!simplified && effectiveStage >= algebraStage) {
    pool.push(makeAlgebra(effectiveStage));
  }

  // Boss-only multi-step problem; only added once so it's not over-represented.
  if (boss) {
    pool.push(makeBossMultiStep(effectiveStage));
  }

  // Pick uniformly from the assembled pool — variety is the spice of practice.
  return pick(pool);
}

/**
 * Convert a user-typed answer string into a number, or null if invalid.
 * Also accepts comma decimals (some locales) and trims whitespace.
 */
export function normalizeAnswer(value) {
  // Coerce to string, trim, swap comma for dot so "2,5" parses like "2.5".
  const trimmed = String(value).trim().replace(",", ".");
  if (!trimmed) return null;
  // Convert to Number; reject if it can't parse to a finite numeric.
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  // Lock to 1 decimal so floating-point comparisons stay sane (e.g. fractions).
  return Math.round(num * 10) / 10;
}
