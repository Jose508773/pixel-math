function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function oneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function makeAddition(scale) {
  const a = randInt(1, 8 + scale * 3);
  const b = randInt(1, 8 + scale * 3);
  return { prompt: `${a} + ${b}`, answer: a + b, type: "addition" };
}

function makeSubtraction(scale) {
  const a = randInt(4 + scale, 14 + scale * 4);
  const b = randInt(1, a - 1);
  return { prompt: `${a} - ${b}`, answer: a - b, type: "subtraction" };
}

function makeMultiplication(scale) {
  const a = randInt(2, 5 + scale);
  const b = randInt(2, 6 + scale);
  return { prompt: `${a} x ${b}`, answer: a * b, type: "multiplication" };
}

function makeDivision(scale) {
  const divisor = randInt(2, 4 + scale);
  const answer = randInt(2, 5 + scale);
  return {
    prompt: `${divisor * answer} / ${divisor}`,
    answer,
    type: "division",
  };
}

function makeFraction(scale) {
  const denominator = randInt(2, 4 + Math.min(scale, 4));
  const numerator = denominator * randInt(1, 2 + scale) + randInt(1, denominator - 1);
  return {
    prompt: `${numerator} / ${denominator} (1 decimal)`,
    answer: oneDecimal(numerator / denominator),
    type: "fraction",
  };
}

function makeExponent(scale) {
  const base = randInt(2, 3 + Math.min(scale, 3));
  const exponent = randInt(2, 3);
  return {
    prompt: `${base}^${exponent}`,
    answer: base ** exponent,
    type: "exponent",
  };
}

function makeAlgebra(scale) {
  const x = randInt(2, 8 + scale);
  const coefficient = randInt(2, 5);
  const constant = randInt(1, 6 + scale);
  const total = coefficient * x + constant;
  return {
    prompt: `${coefficient}x + ${constant} = ${total}`,
    answer: x,
    type: "algebra",
  };
}

function makeBossMultiStep(scale) {
  const a = randInt(2, 4 + scale);
  const b = randInt(2, 5 + scale);
  const c = randInt(3, 8 + scale);
  return {
    prompt: `(${a} x ${b}) + ${c}`,
    answer: a * b + c,
    type: "boss",
  };
}

export function generateProblem(stage, bias = 0, simplified = false, boss = false) {
  const effectiveStage = Math.max(1, stage + bias);
  const pool = [];

  pool.push(makeAddition(effectiveStage), makeSubtraction(effectiveStage));

  if (!simplified && effectiveStage >= 2) {
    pool.push(makeMultiplication(effectiveStage), makeDivision(effectiveStage));
  }

  if (!simplified && effectiveStage >= 4) {
    pool.push(makeFraction(effectiveStage), makeExponent(effectiveStage));
  }

  if (!simplified && effectiveStage >= 6) {
    pool.push(makeAlgebra(effectiveStage));
  }

  if (boss) {
    pool.push(makeBossMultiStep(effectiveStage));
  }

  return pool[randInt(0, pool.length - 1)];
}

export function normalizeAnswer(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (Number.isNaN(num)) return null;
  return Math.round(num * 10) / 10;
}
