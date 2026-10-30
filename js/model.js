/*
 * Swiss tax model: income vs wealth.
 * Population synthesis, calibration, tax schedules, solvers and summaries.
 * Plain script (no modules) so the page also works when opened from disk.
 * See doc/ for the model definition.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Dimensions and default data
  // ---------------------------------------------------------------------------

  const AGE_BANDS = [
    { id: '18-25', lo: 18, hi: 25, retired: false },
    { id: '26-40', lo: 26, hi: 40, retired: false },
    { id: '41-55', lo: 41, hi: 55, retired: false },
    { id: '56-64', lo: 56, hi: 64, retired: false },
    { id: '65-79', lo: 65, hi: 79, retired: true },
    { id: '80+', lo: 80, hi: 95, retired: true },
  ];
  const COMPOSITIONS = ['single', 'couple'];
  const CHILDREN = ['0', '1-2', '3+'];

  // Stylised cell parameters. Edit freely; only a few totals are calibrated.
  // households: count; incMedian: gross household income median (CHF);
  // incSigma: lognormal spread; wMedian: non-pension net wealth median among
  // households with wealth (CHF); wSigma: lognormal spread; wZero: share with
  // roughly zero non-pension wealth.
  // prettier-ignore
  const DEFAULT_CELL_ROWS = [
    // age,    comp,     kids,  hh (k), inc med (k), inc σ, w med (k), w σ, zero share
    ['18-25', 'single', '0',    120,    45,  0.45,   8,  1.2, 0.40],
    ['18-25', 'single', '1-2',    5,    40,  0.45,   3,  1.2, 0.60],
    ['18-25', 'single', '3+',   0.5,    38,  0.45,   2,  1.2, 0.65],
    ['18-25', 'couple', '0',     25,    88,  0.40,  20,  1.2, 0.25],
    ['18-25', 'couple', '1-2',   10,    80,  0.40,  10,  1.2, 0.35],
    ['18-25', 'couple', '3+',     1,    78,  0.40,   8,  1.2, 0.40],
    ['26-40', 'single', '0',    330,    82,  0.45,  40,  1.3, 0.20],
    ['26-40', 'single', '1-2',   50,    68,  0.45,  15,  1.3, 0.35],
    ['26-40', 'single', '3+',     6,    62,  0.45,  10,  1.3, 0.40],
    ['26-40', 'couple', '0',    220,   155,  0.40,  90,  1.3, 0.12],
    ['26-40', 'couple', '1-2',  330,   145,  0.42,  80,  1.3, 0.12],
    ['26-40', 'couple', '3+',    60,   135,  0.45,  70,  1.3, 0.15],
    ['41-55', 'single', '0',    300,    92,  0.50, 120,  1.4, 0.15],
    ['41-55', 'single', '1-2',   80,    82,  0.50,  50,  1.4, 0.25],
    ['41-55', 'single', '3+',    10,    76,  0.50,  40,  1.4, 0.30],
    ['41-55', 'couple', '0',    200,   175,  0.45, 300,  1.3, 0.07],
    ['41-55', 'couple', '1-2',  360,   170,  0.45, 220,  1.3, 0.08],
    ['41-55', 'couple', '3+',    80,   165,  0.48, 200,  1.3, 0.10],
    ['56-64', 'single', '0',    230,    88,  0.50, 200,  1.4, 0.13],
    ['56-64', 'single', '1-2',   15,    85,  0.50, 120,  1.4, 0.20],
    ['56-64', 'single', '3+',     2,    80,  0.50, 100,  1.4, 0.22],
    ['56-64', 'couple', '0',    300,   155,  0.48, 500,  1.3, 0.06],
    ['56-64', 'couple', '1-2',   60,   170,  0.48, 400,  1.3, 0.07],
    ['56-64', 'couple', '3+',     8,   165,  0.50, 350,  1.3, 0.08],
    ['65-79', 'single', '0',    280,    52,  0.50, 250,  1.5, 0.12],
    ['65-79', 'couple', '0',    420,    88,  0.50, 600,  1.4, 0.05],
    ['80+',   'single', '0',    230,    45,  0.50, 280,  1.5, 0.12],
    ['80+',   'couple', '0',    110,    72,  0.50, 650,  1.4, 0.06],
  ];

  function defaultCells() {
    return DEFAULT_CELL_ROWS.map(([age, comp, kids, hh, im, is, wm, ws, wz]) => ({
      age, comp, kids,
      households: hh * 1000,
      incMedian: im * 1000,
      incSigma: is,
      wMedian: wm * 1000,
      wSigma: ws,
      wZero: wz,
    }));
  }

  // All money in CHF per year; rates as fractions.
  const DEFAULTS = {
    revenue: {
      base: 160e9,   // consolidated tax-financed spending net of non-tax revenue (approx.)
      ahvVat: 4.5e9, // VAT points earmarked for AHV, replaced as a separate line (approx.)
    },
    calib: {
      totalIncome: 500e9,   // gross household income incl. pensions (approx., verify against ESTV)
      totalWealth: 5000e9,  // household net wealth incl. pension claims (approx., SNB)
      top1Income: 0.11,     // top 1% share of income (approx., ESTV)
      top1Wealth: 0.42,     // top 1% share of non-pension wealth (approx., ESTV)
      incomeTailQ: 0.97,    // within-cell quantile where the Pareto income tail starts
      wealthTailQ: 0.95,    // same for wealth
      rho: 0.5,             // global income-wealth rank correlation
      rhoAge: [0.6, 0.85, 1.0, 1.1, 1.1, 1.0], // age multipliers on rho
    },
    pop: { perCell: 2000, seed: 42 },
    modelA: { x0: 15000, k: 2.0 },
    modelB: {
      rHigh: 0.01, rLow: 0.0005,
      wLow: 1e6, wHigh: 50e6,
      tMin: 5000, tMax: 500000,
      interp: 'log',
    },
  };

  // Pension-system constants (stylised, roughly 2025 values).
  const BVG = {
    entryThreshold: 22680,
    coordDeduction: 26460,
    minCoord: 3780,
    maxCoord: 64260,
    upperLimit: 90720,
    extraShare: 0.5,         // share of salary above upperLimit insured (super-mandatory)
    extraCap: 300000,
    interest: 0.015,
    credit(age) { return age < 25 ? 0 : age < 35 ? 0.07 : age < 45 ? 0.10 : age < 55 ? 0.15 : age < 65 ? 0.18 : 0; },
    ahvRetired: { single: 28000, couple: 44000 }, // typical AHV pension per household
    bvgShareOfRest: 0.65,    // share of retiree income above AHV that is a BVG annuity
    discount: 0.015,
  };
  const CONTRIB = { ahv: 0.053, alv: 0.011, alvCap: 148200 };
  const PILLAR3A = { yearly: 7258, startAge: 28 };

  // ---------------------------------------------------------------------------
  // Numerics
  // ---------------------------------------------------------------------------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalGen(rng) {
    let spare = null;
    return function () {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0; while (u === 0) u = rng();
      const v = rng();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
  }

  function erfc(x) {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  // Upper tail probability of the standard normal, accurate far into the tail.
  function normSf(z) { return 0.5 * erfc(z / Math.SQRT2); }

  // Inverse standard normal CDF (Acklam).
  function invNorm(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function bisect(f, lo, hi, iters) {
    // f increasing; returns x with f(x) ~ 0
    for (let i = 0; i < iters; i++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid) < 0) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // Share of total x held by the top `frac` of weight. No sorting: bisect on a threshold.
  function topShare(x, w, frac) {
    const n = x.length;
    let totW = 0, totX = 0, max = 0;
    for (let i = 0; i < n; i++) { totW += w[i]; totX += w[i] * x[i]; if (x[i] > max) max = x[i]; }
    if (totX <= 0) return 0;
    const target = frac * totW;
    let lo = 0, hi = max;
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (lo + hi);
      let above = 0;
      for (let i = 0; i < n; i++) if (x[i] > mid) above += w[i];
      if (above > target) lo = mid; else hi = mid;
    }
    // Households strictly above hi hold less than `frac` of weight; top up with
    // the share of the households sitting at the threshold.
    let above = 0, xAbove = 0;
    for (let i = 0; i < n; i++) if (x[i] > hi) { above += w[i]; xAbove += w[i] * x[i]; }
    xAbove += Math.max(0, target - above) * hi;
    return xAbove / totX;
  }

  // ---------------------------------------------------------------------------
  // Pension wealth helpers
  // ---------------------------------------------------------------------------

  // BVG capital at age a per CHF of insured salary, assuming a full career at today's salary.
  const BVG_FACTOR = (function () {
    const f = new Float64Array(101);
    for (let a = 1; a <= 100; a++) f[a] = f[a - 1] * (1 + BVG.interest) + BVG.credit(a - 1);
    return f;
  })();
  function bvgFactor(age) {
    const a = clamp(age, 0, 65);
    const i = Math.floor(a), fr = a - i;
    return i >= 100 ? BVG_FACTOR[100] : BVG_FACTOR[i] * (1 - fr) + BVG_FACTOR[Math.min(100, i + 1)] * fr;
  }

  function insuredSalary(s) {
    if (s < BVG.entryThreshold) return 0;
    const coord = clamp(Math.min(s, BVG.upperLimit) - BVG.coordDeduction, BVG.minCoord, BVG.maxCoord);
    const extra = BVG.extraShare * Math.max(0, Math.min(s, BVG.extraCap) - BVG.upperLimit);
    return coord + extra;
  }

  function lifeExpectancy(age) { return 21 * Math.exp(-0.052 * (age - 65)); }
  function annuityFactor(age) {
    const L = lifeExpectancy(age), v = 1 / (1 + BVG.discount);
    return (1 - Math.pow(v, L)) / (1 - v);
  }

  function bandIndex(id) { return AGE_BANDS.findIndex((b) => b.id === id); }

  // ---------------------------------------------------------------------------
  // Population synthesis and calibration
  // ---------------------------------------------------------------------------

  function buildPopulation(params) {
    const cells = params.cells, calib = params.calib, per = Math.max(50, Math.round(params.pop.perCell));
    const nC = cells.length, n = per * nC;
    const rng = mulberry32(params.pop.seed);
    const normal = normalGen(rng);
    const warnings = [];

    const cellIdx = new Uint16Array(n);
    const weight = new Float64Array(n);
    const age = new Float64Array(n);
    const kids = new Uint8Array(n);
    const eq = new Float64Array(n);
    const zI = new Float64Array(n), sfI = new Float64Array(n);
    const zW = new Float64Array(n), sfW = new Float64Array(n); // conditional on non-zero wealth
    const zeroW = new Uint8Array(n);
    const u3a = new Float64Array(n), uJit = new Float64Array(n), uSplit = new Float64Array(n);

    for (let c = 0; c < nC; c++) {
      const cell = cells[c];
      const bi = bandIndex(cell.age);
      const band = AGE_BANDS[bi];
      const rho = clamp(calib.rho * (calib.rhoAge[bi] ?? 1), -0.95, 0.95);
      const z0 = clamp(cell.wZero, 0, 0.99);
      const w = Math.max(0, cell.households) / per;
      for (let j = 0; j < per; j++) {
        const i = c * per + j;
        const a = normal(), e = normal();
        const zw = rho * a + Math.sqrt(1 - rho * rho) * e;
        cellIdx[i] = c;
        weight[i] = w;
        age[i] = band.lo + rng() * (band.hi - band.lo + 1);
        const uk = rng();
        kids[i] = band.retired ? 0 : cell.kids === '0' ? 0 : cell.kids === '1-2' ? (uk < 0.5 ? 1 : 2) : (uk < 0.7 ? 3 : 4);
        eq[i] = 1 + (cell.comp === 'couple' ? 0.5 : 0) + 0.3 * kids[i];
        zI[i] = a; sfI[i] = normSf(a);
        const sf = normSf(zw);
        if (sf > 1 - z0) { zeroW[i] = 1; }
        else {
          const sfc = sf / (1 - z0);
          sfW[i] = sfc;
          zW[i] = -invNorm(sfc);
        }
        u3a[i] = rng(); uJit[i] = rng(); uSplit[i] = rng();
      }
    }

    // --- Income: lognormal body with a shared Pareto tail -------------------
    const qI = clamp(calib.incomeTailQ, 0.5, 0.9999), zqI = invNorm(qI);
    const rawInc = new Float64Array(n);
    function fillIncome(alpha) {
      for (let i = 0; i < n; i++) {
        const cell = cells[cellIdx[i]];
        rawInc[i] = sfI[i] < 1 - qI
          ? cell.incMedian * Math.exp(cell.incSigma * zqI) * Math.pow((1 - qI) / sfI[i], 1 / alpha)
          : cell.incMedian * Math.exp(cell.incSigma * zI[i]);
      }
    }
    const alphaI = calibrateAlpha(fillIncome, rawInc, weight, calib.top1Income, 'income', warnings);
    let totRaw = 0;
    for (let i = 0; i < n; i++) totRaw += weight[i] * rawInc[i];
    const sI = totRaw > 0 ? calib.totalIncome / totRaw : 0;

    // --- Derived income items and pension wealth ----------------------------
    const gross = new Float64Array(n), taxable = new Float64Array(n), pension = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const cell = cells[cellIdx[i]];
      const g = sI * rawInc[i];
      gross[i] = g;
      const a = age[i];
      if (a < 65) {
        // Earner split: singles one earner; couples share income between two.
        const shares = cell.comp === 'couple' ? [0.55 + 0.25 * uSplit[i], 0.45 - 0.25 * uSplit[i]] : [1];
        let contrib = 0, cap = 0;
        for (const sh of shares) {
          const s = g * sh;
          const ins = insuredSalary(s);
          contrib += CONTRIB.ahv * s + CONTRIB.alv * Math.min(s, CONTRIB.alvCap) + 0.5 * BVG.credit(a) * ins;
          cap += bvgFactor(a) * ins;
          // Pillar 3a: participation rises with income.
          const p3 = clamp((s - 30000) / 100000, 0.15, 0.8);
          if (u3a[i] < p3 && a > PILLAR3A.startAge) cap += PILLAR3A.yearly * (a - PILLAR3A.startAge);
        }
        taxable[i] = Math.max(0, g - contrib);
        pension[i] = cap;
      } else {
        // Retirees: income includes pensions; value the remaining BVG annuity.
        const ahv = BVG.ahvRetired[cell.comp];
        const annuity = Math.max(0, g - ahv) * BVG.bvgShareOfRest;
        taxable[i] = g;
        pension[i] = annuity * annuityFactor(a);
      }
    }

    // --- Non-pension wealth --------------------------------------------------
    const qW = clamp(calib.wealthTailQ, 0.5, 0.9999), zqW = invNorm(qW);
    const rawW = new Float64Array(n);
    function fillWealth(alpha) {
      for (let i = 0; i < n; i++) {
        if (zeroW[i]) { rawW[i] = 0; continue; }
        const cell = cells[cellIdx[i]];
        rawW[i] = sfW[i] < 1 - qW
          ? cell.wMedian * Math.exp(cell.wSigma * zqW) * Math.pow((1 - qW) / sfW[i], 1 / alpha)
          : cell.wMedian * Math.exp(cell.wSigma * zW[i]);
      }
    }
    const alphaW = calibrateAlpha(fillWealth, rawW, weight, calib.top1Wealth, 'wealth', warnings);
    let totRawW = 0, totPension = 0;
    for (let i = 0; i < n; i++) { totRawW += weight[i] * rawW[i]; totPension += weight[i] * pension[i]; }
    let sW = totRawW > 0 ? (calib.totalWealth - totPension) / totRawW : 0;
    if (sW <= 0) {
      warnings.push('Modelled pension wealth alone exceeds the total wealth target; non-pension wealth set to near zero.');
      sW = 1e-6;
    }
    const nonPension = new Float64Array(n), wealth = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Households with "zero" wealth get a small buffer of up to CHF 5,000.
      const np = zeroW[i] ? 5000 * uJit[i] : sW * rawW[i];
      nonPension[i] = np;
      wealth[i] = np + pension[i];
    }

    return {
      n, per, cells, cellIdx, weight, age, kids, eq, gross, taxable, pension, nonPension, wealth,
      diag: {
        alphaI, alphaW, sI, sW, totPension,
        achievedTop1Income: topShare(taxable, weight, 0.01),
        achievedTop1NonPension: topShare(nonPension, weight, 0.01),
        top1Wealth: topShare(wealth, weight, 0.01),
        totalHouseholds: sum(weight),
        totalTaxable: dot(weight, taxable),
        totalWealth: dot(weight, wealth),
      },
      warnings,
    };
  }

  function calibrateAlpha(fill, arr, w, target, what, warnings) {
    const lo = Math.log(1.05), hi = Math.log(20);
    const share = (la) => { fill(Math.exp(la)); return topShare(arr, w, 0.01); };
    const sLo = share(lo), sHi = share(hi);
    let la;
    if (target >= sLo) {
      la = lo;
      warnings.push(`Top 1% ${what} share of ${(target * 100).toFixed(1)}% is above what the tail can reach (${(sLo * 100).toFixed(1)}%).`);
    } else if (target <= sHi) {
      la = hi;
      warnings.push(`Top 1% ${what} share of ${(target * 100).toFixed(1)}% is below what the cell spreads already produce (${(sHi * 100).toFixed(1)}%). Lower the spreads.`);
    } else {
      // share decreases with alpha
      la = bisect((x) => target - share(x), lo, hi, 30);
    }
    const alpha = Math.exp(la);
    fill(alpha);
    return alpha;
  }

  function sum(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  // ---------------------------------------------------------------------------
  // Model A: progressive income tax
  // ---------------------------------------------------------------------------

  // Marginal rate t(x) = tmax * (1 - (x0/x)^k) for x > x0. Returns the tax per
  // unit of tmax, i.e. the integral of (1 - (x0/s)^k) from x0 to x.
  function taxAUnit(x, x0, k) {
    if (x <= x0) return 0;
    if (x0 <= 0) return x;
    if (Math.abs(k - 1) < 1e-9) return (x - x0) - x0 * Math.log(x / x0);
    return (x - x0) - Math.pow(x0, k) * (Math.pow(x, 1 - k) - Math.pow(x0, 1 - k)) / (1 - k);
  }
  function marginalA(x, x0, k, tmax) { return x <= x0 ? 0 : tmax * (1 - Math.pow(x0 / x, k)); }

  function solveA(pop, p, target) {
    const tax = new Float64Array(pop.n);
    let base = 0;
    for (let i = 0; i < pop.n; i++) {
      const u = pop.eq[i] * taxAUnit(pop.taxable[i] / pop.eq[i], p.x0, p.k);
      tax[i] = u;
      base += pop.weight[i] * u;
    }
    // Revenue is linear in tmax, so the solution is exact (no iteration needed).
    const tmax = base > 0 ? target / base : Infinity;
    for (let i = 0; i < pop.n; i++) tax[i] *= tmax;
    const warnings = [];
    if (!isFinite(tmax)) warnings.push('No household is above the allowance: Model A cannot raise any revenue.');
    else if (tmax >= 1) warnings.push(`The top marginal rate would have to be ${(tmax * 100).toFixed(0)}%, above 100%. Lower the allowance or raise k.`);
    else if (tmax > 0.6) warnings.push(`Top marginal rate of ${(tmax * 100).toFixed(1)}% is above 60%.`);
    return { tmax, tax, warnings };
  }

  // ---------------------------------------------------------------------------
  // Model B: regressive wealth tax with floor and cap
  // ---------------------------------------------------------------------------

  const GUARD_GRID = 2000;

  function makeScheduleB(p, lambda) {
    const rh = p.rHigh * lambda, rl = p.rLow * lambda;
    const wLow = Math.max(1, p.wLow), wHigh = Math.max(wLow * 1.0001, p.wHigh);
    const lnRatio = Math.log(wHigh / wLow);
    const linear = p.interp === 'linear';
    function rate(W) {
      if (W <= wLow) return rh;
      if (W >= wHigh) return rl;
      const f = linear ? (W - wLow) / (wHigh - wLow) : Math.log(W / wLow) / lnRatio;
      return rh - (rh - rl) * f;
    }
    function raw(W) {
      if (W <= 0) return 0;
      const t = rate(W) * W;
      if (t < p.tMin) return 0;
      return Math.min(t, p.tMax);
    }
    // Monotonicity guard: rate * W can fall with W between wLow and wHigh.
    // Keep tax non-decreasing by taking the running max on a log grid.
    const lnLo = Math.log(wLow), step = lnRatio / (GUARD_GRID - 1);
    const runMax = new Float64Array(GUARD_GRID);
    let m = 0;
    for (let g = 0; g < GUARD_GRID; g++) { m = Math.max(m, raw(Math.exp(lnLo + g * step))); runMax[g] = m; }
    function guarded(W) {
      const r = raw(W);
      if (W <= wLow) return r;
      const g = W >= wHigh ? GUARD_GRID - 1 : Math.floor((Math.log(W) - lnLo) / step);
      return Math.max(r, runMax[g]);
    }
    return { rate, raw, guarded, rh, rl };
  }

  function revenueB(pop, p, lambda) {
    const s = makeScheduleB(p, lambda);
    let r = 0;
    for (let i = 0; i < pop.n; i++) r += pop.weight[i] * s.guarded(pop.wealth[i]);
    return r;
  }

  function solveB(pop, p, target) {
    const warnings = [];
    const lamMax = p.rHigh > 0 ? 1 / p.rHigh : 1; // highest rate capped at 100% of wealth
    const maxRevenue = revenueB(pop, p, lamMax);
    let lambda, reachable = true;
    if (maxRevenue < target) {
      reachable = false;
      lambda = lamMax;
      warnings.push(`Target unreachable: even at a 100% rate the cap of CHF ${Math.round(p.tMax).toLocaleString('en-US')} limits revenue to CHF ${(maxRevenue / 1e9).toFixed(1)} bn. Raise the cap.`);
    } else {
      // Bisection in log(lambda); revenue is non-decreasing in lambda.
      let lo = Math.log(1e-6), hi = Math.log(lamMax);
      for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (lo + hi);
        if (revenueB(pop, p, Math.exp(mid)) < target) lo = mid; else hi = mid;
      }
      lambda = Math.exp(hi);
    }
    const s = makeScheduleB(p, lambda);
    const tax = new Float64Array(pop.n);
    const guardBinds = new Uint8Array(pop.n);
    let revenue = 0;
    for (let i = 0; i < pop.n; i++) {
      const W = pop.wealth[i];
      const t = s.guarded(W), r = s.raw(W);
      tax[i] = t;
      if (t > r + 1e-6) guardBinds[i] = 1;
      revenue += pop.weight[i] * t;
    }
    if (s.rh > 0.1) warnings.push(`Rates had to be scaled ×${lambda.toFixed(1)}: the top wealth-tax rate is ${(s.rh * 100).toFixed(1)}% per year.`);
    return { lambda, rHigh: s.rh, rLow: s.rl, reachable, maxRevenue, revenue, tax, guardBinds, schedule: s, warnings };
  }

  // ---------------------------------------------------------------------------
  // Evaluation and summaries
  // ---------------------------------------------------------------------------

  function evaluate(pop, params) {
    const target = params.revenue.base + params.revenue.ahvVat;
    const A = solveA(pop, params.modelA, target);
    const B = solveB(pop, params.modelB, target);
    return { target, A, B };
  }

  const CHILD_LABEL = { '0': 'no children', '1-2': '1–2 children', '3+': '3+ children' };
  function cellLabel(cell) {
    const band = AGE_BANDS[bandIndex(cell.age)];
    const kid = band.retired ? '' : `, ${CHILD_LABEL[cell.kids]}`;
    return `${cell.age.replace('-', '–')}, ${cell.comp}${kid}`;
  }

  function groupKey(cell, by, index) {
    switch (by) {
      case 'age': return cell.age.replace('-', '–');
      case 'comp': return cell.comp === 'single' ? 'Single' : 'Couple';
      case 'kids': return AGE_BANDS[bandIndex(cell.age)].retired ? 'Retired (65+)' : CHILD_LABEL[cell.kids].replace(/^./, (c) => c.toUpperCase());
      case 'all': return 'All households';
      default: return index;
    }
  }

  function weightedQuantiles(idx, val, w, qs) {
    const sorted = idx.slice().sort((a, b) => val[a] - val[b]);
    let tot = 0;
    for (const i of sorted) tot += w[i];
    const out = [];
    let cum = 0, k = 0;
    for (const q of qs) {
      const target = q * tot;
      while (k < sorted.length - 1 && cum + w[sorted[k]] < target) { cum += w[sorted[k]]; k++; }
      out.push(sorted.length ? val[sorted[k]] : 0);
    }
    return out;
  }

  function summarize(pop, ev, by) {
    const groups = new Map();
    for (let i = 0; i < pop.n; i++) {
      const c = pop.cellIdx[i];
      const key = groupKey(pop.cells[c], by, c);
      if (!groups.has(key)) groups.set(key, { key, label: by === 'cell' ? cellLabel(pop.cells[c]) : key, cell: by === 'cell' ? c : null, idx: [] });
      groups.get(key).idx.push(i);
    }
    const totW = pop.diag.totalHouseholds;
    const revA = ev.target, revB = ev.B.revenue;
    const rows = [];
    for (const g of groups.values()) {
      let W = 0, inc = 0, wl = 0, tA = 0, tB = 0, more = 0, flagged = 0, pen = 0;
      for (const i of g.idx) {
        const w = pop.weight[i];
        W += w; inc += w * pop.taxable[i]; wl += w * pop.wealth[i]; pen += w * pop.pension[i];
        tA += w * ev.A.tax[i]; tB += w * ev.B.tax[i];
        if (ev.B.tax[i] > ev.A.tax[i]) more += w;
        if (ev.B.tax[i] > 0 && ev.B.tax[i] > pop.taxable[i]) flagged += w;
      }
      const [incMed] = weightedQuantiles(g.idx, pop.taxable, pop.weight, [0.5]);
      const [wMed] = weightedQuantiles(g.idx, pop.wealth, pop.weight, [0.5]);
      const qA = weightedQuantiles(g.idx, ev.A.tax, pop.weight, [0.1, 0.5, 0.9]);
      const qB = weightedQuantiles(g.idx, ev.B.tax, pop.weight, [0.1, 0.5, 0.9]);
      rows.push({
        key: g.key, label: g.label, cell: g.cell,
        households: W, hhShare: W / totW,
        incomeMedian: incMed, wealthMedian: wMed,
        avgA: W ? tA / W : 0, avgB: W ? tB / W : 0,
        pctIncA: inc ? tA / inc : 0, pctIncB: inc ? tB / inc : 0,
        pctWealthA: wl ? tA / wl : 0, pctWealthB: wl ? tB / wl : 0,
        revShareA: revA ? tA / revA : 0, revShareB: revB ? tB / revB : 0,
        qA, qB,
        shareMoreB: W ? more / W : 0,
        flaggedShare: W ? flagged / W : 0, flagged,
        pensionShare: wl ? pen / wl : 0,
      });
    }
    return rows;
  }

  // Tax as % of income by percentile of `key` ('taxable' or 'wealth').
  function percentileCurve(pop, ev, key) {
    const val = pop[key];
    const idx = Array.from({ length: pop.n }, (_, i) => i).sort((a, b) => val[a] - val[b]);
    const edges = [];
    for (let p = 0; p < 98; p += 2) edges.push(p / 100);
    edges.push(0.98, 0.99, 0.995, 0.999, 1);
    const tot = pop.diag.totalHouseholds;
    const bins = [];
    let k = 0, cum = 0;
    for (let b = 0; b < edges.length - 1; b++) {
      const hiW = edges[b + 1] * tot;
      let inc = 0, tA = 0, tB = 0, w = 0, v = 0;
      while (k < idx.length && (cum + pop.weight[idx[k]] <= hiW + 1e-6 || b === edges.length - 2)) {
        const i = idx[k], wi = pop.weight[i];
        inc += wi * pop.taxable[i]; tA += wi * ev.A.tax[i]; tB += wi * ev.B.tax[i]; w += wi; v += wi * val[i];
        cum += wi; k++;
      }
      if (w > 0) bins.push({ lo: edges[b], hi: edges[b + 1], mid: (edges[b] + edges[b + 1]) / 2, mean: v / w, rateA: inc ? tA / inc : 0, rateB: inc ? tB / inc : 0 });
    }
    return bins;
  }

  function modelBStats(pop, ev) {
    const p = ev.B;
    let zero = 0, guard = 0, flagged = 0, tot = 0;
    for (let i = 0; i < pop.n; i++) {
      const w = pop.weight[i];
      tot += w;
      if (p.tax[i] === 0) zero += w;
      if (p.guardBinds[i]) guard += w;
      if (p.tax[i] > 0 && p.tax[i] > pop.taxable[i]) flagged += w;
    }
    return { zeroShare: zero / tot, guardShare: guard / tot, flaggedShare: flagged / tot, flagged };
  }

  function capShare(pop, ev, tMax) {
    let cap = 0, tot = 0;
    for (let i = 0; i < pop.n; i++) { tot += pop.weight[i]; if (ev.B.tax[i] >= tMax - 0.5) cap += pop.weight[i]; }
    return cap / tot;
  }

  const api = {
    AGE_BANDS, COMPOSITIONS, CHILDREN, DEFAULTS, defaultCells, cellLabel,
    buildPopulation, evaluate, solveA, solveB, makeScheduleB, taxAUnit, marginalA,
    summarize, percentileCurve, modelBStats, capShare, topShare, insuredSalary, bvgFactor, annuityFactor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TaxModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
