# Tax Model: Income vs Wealth — Model Definition

Oct 30, 2026 · @Christophe Alexandre

An illustrative browser tool comparing two ways of funding a Switzerland-like state: a fully progressive income tax (Model A) and a regressive wealth tax with a minimum and a maximum payment per household (Model B). Each must cover the same revenue target. The goal is a rough picture of taxes paid by household category, not a forecast.

## 1. Revenue target

The tax covers consolidated spending of Confederation, cantons and communes, minus their non-tax revenue (fees, SNB distributions, property income). Social insurances stay outside: anything on the payroll stays on the payroll.

Two edge cases are handled explicitly:

- **Federal and cantonal subsidies to AHV/IV** are ordinary tax-financed government expenditure today, so they stay in the target.
- **VAT percentage points earmarked for AHV** flow straight into AHV. VAT is abolished in both models, so the new tax must replace this money too, as a separate line item.

Order of magnitude: roughly CHF 150–170 bn per year (approximate). The exact figure for the latest available year comes from the EFV financial statistics at build time.

## 2. Population: about 28 household cells

The modeling unit is the household; children are an attribute of a household. Housing tenure is dropped, since its effect can sit inside each cell's wealth parameters.

| Dimension | Levels |
| --- | --- |
| Age of reference person | 18–25, 26–40, 41–55, 56–64, 65–79, 80+ |
| Composition | Single, couple |
| Dependent children (under 65 only) | 0, 1–2, 3+ |

That gives 4 × 2 × 3 + 2 × 2 = 28 cells. Each cell holds five numbers: household count, income median, income spread, wealth median, and share with roughly zero wealth.

A shared Pareto tail sits on top of every cell, for income and for wealth. The income–wealth correlation is a single global value, adjusted by age. Comparisons across household types use the OECD-modified equivalence scale (1 / 0.5 / 0.3).

## 3. Income definition (Model A base)

Taxable income = gross labour income + capital income + pensions (AHV and BVG) − employee social contributions.

- Payroll stays on the payroll, so contributions are deductible, as today.
- Pensions are taxed like any other income (default).
- The progressive schedule applies to equivalised household income.

## 4. Wealth definition (Model B base)

Taxable wealth = net wealth at market value: financial assets, real estate and business equity, minus debt. Pension wealth is included.

- **BVG capital and 3a** build up with age and income until 65. In each cell they are a function of age × income, not a separate random draw.
- **After 65**, the present value of the remaining BVG annuity is used, so wealth does not fall off a cliff when capital turns into a pension.
- **AHV** is pay-as-you-go, so it has no capital and is excluded.

Consequence to show in the tool: with pension wealth in the base and a regressive schedule, the burden concentrates on households just above the floor, mostly the 41–64 middle class, whose wealth is largely illiquid pension capital. The tool flags households whose tax exceeds their income.

## 5. Calibration (illustrative)

Parameters are stylised and scaled so that only a handful of totals match published figures:

| Target | Source |
| --- | --- |
| Household counts per cell | BFS |
| Total taxable household income | ESTV direct federal tax statistics |
| Total household net wealth incl. pension claims | SNB financial accounts |
| Top 1% share of income and of wealth (sets the Pareto tails) | ESTV |

Everything else is a plausible stylised value, documented in the tool so anyone can edit it.

## 6. Schedules and solver

**Model A: progressive income tax.** Tax-free allowance x₀, then a rising marginal rate with steepness k:

```latex
t(x) = t_{max} \cdot \left(1 - \left(\frac{x_0}{x}\right)^{k}\right) \quad \text{for } x > x_0
```

- The user sets x₀ and k; the solver finds the t\_max that makes revenue equal the target (bisection).
- Warning if t\_max exceeds about 60% marginal.

**Model B: regressive wealth tax with a floor and a cap.** Applied per household on net wealth W (not equivalised, since floor and cap are per household).

| Parameter | Meaning | Default |
| --- | --- | --- |
| r\_high | Rate at and below W\_low | 1% |
| r\_low | Rate at and above W\_high | 0.05% |
| W\_low | Wealth where the rate starts to decline | to set |
| W\_high | Wealth where the rate reaches r\_low (UHNWI) | to set |
| T\_min | Minimum payment; computed tax below it → 0 | CHF 5,000 |
| T\_max | Maximum payment per household | CHF 500,000 |

The rate falls linearly between the two extremes. By default the interpolation is linear in log(W), because wealth spans several orders of magnitude; a toggle allows linear in W (which keeps the rate near r\_high for almost everyone).

```latex
r(W) = r_{high} - (r_{high} - r_{low}) \cdot \frac{\ln(W / W_{low})}{\ln(W_{high} / W_{low})}
```

```latex
T(W) = \begin{cases} 0 & \text{if } r(W) \cdot W < T_{min} \\ \min(r(W) \cdot W,\ T_{max}) & \text{otherwise} \end{cases}
```

- **Floor cliff:** at r\_high = 1% and T\_min = CHF 5,000, households below CHF 500,000 pay nothing and those just above pay 5,000. This is intended; the tool shows the cliff.
- **Monotonicity guard:** with a falling rate, r(W)·W can decrease with wealth near the top. The tool keeps tax non-decreasing in wealth and flags where this binds.
- **Solver:** scales r\_high and r\_low by a common factor until revenue equals the target; T\_min, T\_max, W\_low and W\_high stay as set. If the cap makes the target unreachable, the tool says so.
- **Rough expectation (approximate):** household net wealth including pensions is in the CHF thousands of billions, so rates capped at 1% likely fall well short of a \~CHF 160 bn target. Expect the solver to scale rates several-fold.

## 7. Outputs per category

For each of the 28 cells (and grouped by age, composition or children), under Model A and Model B:

- Average tax per household (CHF)
- Tax as % of income
- Tax as % of wealth
- Spread within the cell: p10, median, p90
- The cell's share of total revenue vs its share of households
- Who pays more under B than under A: a difference heatmap of age × composition/children

Secondary views: effective-rate curves by income and wealth percentile, the list of flagged illiquid households, and for Model B the share of households below the floor (paying 0) and at the cap.

## 8. Defaults and next step

- Model A taxes pensions like any other income (default, open to change).
- Behaviour is static; optional elasticity sliders (taxable-income response for A, wealth flight / underreporting for B) can be added later.

* [ ] Next: write the full implementation prompt (single-page browser app, data inputs, solver, charts), or build the tool directly.
