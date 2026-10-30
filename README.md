# Swiss Tax Model: Income vs Wealth

An illustrative browser tool comparing two ways of funding a Switzerland-like state:

- **Model A — progressive income tax.** A tax-free allowance, then a marginal rate that rises toward a ceiling.
- **Model B — regressive wealth tax.** A rate that falls as net wealth rises, with a minimum and a maximum payment per household.

Both models replace today's taxes (including VAT) and must raise the same revenue. The tool shows roughly how much each household category would pay under each model. It is meant as a rough picture, not a forecast.

> **Status:** first working version. Calibration figures are approximate placeholders and still need checking against the sources.

## Launch the tool

The tool is a single web page. It needs no installation, no build step and no internet connection once downloaded. Any recent browser works (Chrome, Firefox, Safari, Edge).

### Option 1: use it online

Open **https://chris-ch.github.io/swiss-tax-model/**

### Option 2: run it on your computer

1. Download the project, either:
   - with git: `git clone https://github.com/chris-ch/swiss-tax-model.git`
   - or without git: on the GitHub page click **Code → Download ZIP**, then unzip it.
2. Open the `swiss-tax-model` folder and double-click **`index.html`**. It opens in your browser.

Keep `index.html` and the `js/` folder together: the page loads its code from there.

If your browser blocks local files (some corporate setups do), serve the folder instead:

```bash
cd swiss-tax-model
python3 -m http.server 8000
```

Then open http://localhost:8000.

### Publish it online

For maintainers, to serve the tool from GitHub:

1. On GitHub, open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **`main`**, folder **`/ (root)`**, and click **Save**.
3. After a minute or two the tool is live at https://chris-ch.github.io/swiss-tax-model/. Every push to `main` updates it.

GitHub Pages is free for public repositories; private ones need a paid plan.

## Using the tool

- **Settings (left panel, or top on phones):** the revenue target and the parameters of each model. Results update as you type.
- **Summary cards:** the top income-tax rate Model A needs, the wealth-tax rates Model B needs after scaling, how many households pay nothing or hit the cap, and how many would owe more wealth tax than their income.
- **Heatmap:** who pays more under B than under A, by age and household type. Switch between CHF difference, share of households and percentage points of income.
- **Category table:** taxes for all 28 household types, or grouped by age, composition or children.
- **Charts:** effective rates by income and wealth percentile, and both tax schedules. Hover (or tap) for values.
- **Calibration and population data** (collapsed at the bottom): the published totals the model is scaled to, and an editable table of the 28 household types.
- **Reset to defaults** restores all settings.

All figures are stylised and approximate. Treat results as orders of magnitude.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout and styles |
| `js/model.js` | Population, calibration, tax schedules and solvers (also runs in Node) |
| `js/app.js` | Controls, tables and charts |
| `doc/` | Model definition |

## How the model works

| Part | Summary |
| --- | --- |
| Revenue target | Consolidated spending of Confederation, cantons and communes, minus non-tax revenue, plus the VAT share currently earmarked for AHV. Roughly CHF 150–170 bn per year, taken from EFV financial statistics. Social insurances stay on the payroll. |
| Population | 28 household cells: age of reference person (6 bands) × single/couple × dependent children (0, 1–2, 3+, under 65 only). Each cell has a household count plus income and wealth distributions, with a shared Pareto tail. |
| Income base (A) | Labour + capital income + pensions − employee social contributions, equivalised with the OECD-modified scale. |
| Wealth base (B) | Net wealth at market value, including BVG and 3a pension capital (present value of the BVG annuity after 65). AHV is excluded. |
| Calibration | Stylised parameters scaled to match a few published totals (BFS household counts, ESTV income and top-1% shares, SNB household wealth). |
| Solvers | Model A: the top marginal rate is solved exactly, since revenue is proportional to it. Model B: bisection on a common scale factor for both wealth tax rates, until revenue matches the target. |

## Outputs

For each of the 28 cells, and grouped by age, composition or children:

- average tax per household, as % of income and as % of wealth
- spread within the cell (p10, median, p90)
- share of total revenue vs share of households
- a heatmap of who pays more under B than under A

The tool also flags households whose wealth tax exceeds their income, shows how much of their wealth is pension capital they cannot sell, and shows the Model B floor cliff and cap.

## Documentation

The full specification, with formulas, defaults and edge cases, is in
[doc/Tax Model Income vs Wealth — Model Definition.md](<doc/Tax Model Income vs Wealth — Model Definition.md>).

## License

[MIT](LICENSE)
