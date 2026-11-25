// Token Radar's value model: one sealed snapshot in, one ranked board out.
//
// The model in one paragraph. The snapshot itself contains the market's own answer to "what is a
// token worth next to the TVL behind it": every protocol that already trades carries a market cap
// and a TVL, so the ratio mcap / TVL is observable, per category, from the data. This model
// calibrates on those live-token protocols, then prices each pre-token protocol as
//
//   implied = TVL x category_multiple x growth_multiplier x maturity_multiplier x breadth_multiplier
//
// where category_multiple is the snapshot's own median mcap/TVL for the protocol's category,
// winsorised and shrunk toward the global median by the category's sample size. Growth, tokenless
// age and chain breadth adjust the base. No protocol name is ever special-cased, no multiple is
// hand-set per protocol, and every constant below is stated on the dashboard.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  winsor_low: number;
  winsor_high: number;
  prior_weight: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_min_multiplier: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  breadth_per_chain: number;
  breadth_max_steps: number;
}

export const MODEL: ModelConstants = {
  winsor_low: 0.02,
  winsor_high: 2.5,
  prior_weight: 6,
  growth_weight: 0.9,
  growth_floor: -40,
  growth_cap: 60,
  growth_min_multiplier: 0.5,
  maturity_floor: 0.78,
  maturity_range: 0.32,
  maturity_days: 1460,
  breadth_per_chain: 0.015,
  breadth_max_steps: 8,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'calibrated-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 40;

/** One category's calibration, derived from the snapshot's live-token protocols. */
export interface CategoryCalibration {
  category: string;
  live_n: number;
  median_multiple: number;
  multiple: number;
}

/** The whole calibration: the global median multiple and every category's shrunk multiple. */
export interface Calibration {
  global_multiple: number;
  live_n: number;
  unknown_age_days: number;
  categories: CategoryCalibration[];
  byCategory: Map<string, CategoryCalibration>;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_median_multiple: number;
    calibration_n: number;
    global_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_plan: { capital_usd: number; est_fees_usd: number; weeks: number };
  farm_steps: string[];
}

/** The dashboard's view of one board row, farm plan included so page and board cannot drift. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  category_median_multiple: number;
  calibration_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_capital_usd: number;
  farm_fees_usd: number;
  farm_weeks: number;
  farm_steps: string[];
}

/** A pre-token protocol above the floor that the watchlist leaves out: set aside, never ranked. */
export interface AsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  calibration_live_n: number;
  unknown_age_days: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration: CategoryCalibration[];
  rows: RadarRow[];
  live: LiveRow[];
  aside: AsideRow[];
  aside_size: number;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The calibration, computed from the snapshot alone: winsorised mcap/TVL ratios of every live-token
 * protocol, the global median, each category's median shrunk toward the global by its sample size,
 * and the median known tokenless age used when a protocol's listing date is absent.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const ratios: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = Math.min(model.winsor_high, Math.max(model.winsor_low, p.mcap_usd / p.tvl_usd));
    ratios.push(r);
    const key = p.category ?? 'Uncategorised';
    const list = byCat.get(key) ?? [];
    list.push(r);
    byCat.set(key, list);
  }
  const global = ratios.length > 0 ? median(ratios) : 0.2;
  const categories: CategoryCalibration[] = [...byCat.entries()]
    .map(([category, list]) => {
      const med = median(list);
      const shrunk = (list.length * med + model.prior_weight * global) / (list.length + model.prior_weight);
      return { category, live_n: list.length, median_multiple: round4(med), multiple: round4(shrunk) };
    })
    .sort((a, b) => b.live_n - a.live_n || (a.category < b.category ? -1 : 1));
  const ages = snapshot.protocols
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  return {
    global_multiple: round4(global),
    live_n: ratios.length,
    unknown_age_days: ages.length > 0 ? Math.round(median(ages)) : 365,
    categories,
    byCategory: new Map(categories.map((c) => [c.category, c])),
  };
}

/** The four multipliers and the implied value one protocol gets under `model` + `calibration`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  calibration: Calibration,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null; cal: CategoryCalibration } {
  const age = ageDays(asOf, protocol.listed_at);
  const cal = calibration.byCategory.get(protocol.category ?? 'Uncategorised') ??
    { category: protocol.category ?? 'Uncategorised', live_n: 0, median_multiple: calibration.global_multiple, multiple: calibration.global_multiple };
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = Math.max(model.growth_min_multiplier, 1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? calibration.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_steps);
  const implied = Math.min(100_000_000_000_000, Math.max(1, Math.round(protocol.tvl_usd * cal.multiple * growthMult * maturityMult * breadthMult)));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age, cal };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. Every rankable pre-token protocol is ranked. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const calibration = calibrate(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is on the board, whatever the filters below would say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, not a TVL-cut
  // sample. Above the floor the board takes the house's own line: a pre-token record that is not
  // on the watchlist is a wrapped, staked or bridged product, an exchange, or another protocol's
  // product, so it is set aside (see setAside) rather than ranked as a launch candidate.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, calibration) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const plan = farmPlan(s.p, s.age);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      watchlist: watch.has(s.p.slug),
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        category_multiple: s.cal.multiple,
        category_median_multiple: s.cal.median_multiple,
        calibration_n: s.cal.live_n,
        global_multiple: calibration.global_multiple,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        breadth_multiplier: round4(s.breadthMult),
        age_days: s.age,
      },
      farm_plan: { capital_usd: plan.capital, est_fees_usd: plan.fees, weeks: plan.weeks },
      farm_steps: plan.steps,
    };
  });
}

// ---------------------------------------------------------------- farm plans
// The derivation below is mirrored, function for function and string for string, in
// dashboard/app.js between its farm-logic markers, so the page renders exactly the plan
// board.json carries. Change one, change the other.

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Working capital for one farm position, tiered by the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 400;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 75;
}

/** A realistic per-transaction network fee in USD for the protocol's first chain. */
export function gasFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 14;
  if (c === 'solana' || c === 'polygon' || c.includes('arbitrum') || c.includes('optimism') || c === 'base' || c.includes('zksync') || c === 'linea' || c === 'scroll' || c === 'mantle' || c === 'blast' || c === 'mode' || c === 'taiko') return 1;
  if (c.includes('bnb') || c.includes('bsc') || c.includes('avalanche') || c.includes('fantom') || c.includes('sonic')) return 2;
  return 3;
}

/** Campaign length in weeks, from tokenless age: younger protocols need a longer qualifying window. */
export function weeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 540) return 6;
  return 4;
}

/** The category's two working actions: the core position and a second, different qualifying action. */
export function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const third = Math.max(10, Math.round(capital * 0.3));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return [
    `Supply $${capital} of USDC as collateral in ${name} on ${chain}, then borrow $${third} against it and re-supply the borrowed amount once, keeping loan-to-value under 40%.`,
    `Repay half the borrow, withdraw 10% of the supply, then restore both legs within the same session, so the wallet registers as borrower and supplier, not a one-way depositor.`,
  ];
  if (c.includes('dex') || c.includes('swap')) return [
    `Add $${capital} of balanced liquidity to ${name}'s highest-TVL stable or native pair on ${chain}, split evenly across both assets, and keep the LP position open.`,
    `Swap $${third} through ${name}'s main pair and move the LP range or tranche once, so the wallet shows trading volume as well as liquidity depth.`,
  ];
  if (c.includes('bridge') || c.includes('canonical') || c.includes('cross chain')) return [
    `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then deposit the bridged funds into a money market on the destination chain instead of leaving them idle.`,
    `Bridge $${third} back to Ethereum and re-bridge it a week later, so the wallet has transfers in both directions rather than a single one-way hop.`,
  ];
  if (c.includes('staking') || c.includes('restak')) return [
    `Stake $${capital} worth of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt token in the same wallet for the whole campaign.`,
    `Claim the accrued staking rewards, restake them through ${name}, and record the receipt-token balance before and after in the farm log.`,
  ];
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('interest rate')) return [
    `Deposit $${capital} of USDC as margin on ${name} and run a hedged pair: hold $${third} of spot in the same wallet and short the same notional on ${name}, so price risk stays near neutral.`,
    `Roll the hedge once: close the short, re-open it at the new spot price, and log both funding payments, keeping total fees visible rather than chasing volume.`,
  ];
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault') || c.includes('yield') || c.includes('farm') || c.includes('liquidity manager')) return [
    `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and keep the vault shares untouched for the first two weeks of the campaign.`,
    `Add a second tranche of $${third}, then harvest any accrued yield and re-deposit it into the same vault, so deposits, harvests and compounding all appear on one wallet.`,
  ];
  if (c.includes('rwa')) return [
    `Subscribe $${capital} to ${name}'s yield-bearing asset on ${chain} after its own onboarding check, and hold the issued asset in the farming wallet.`,
    `Redeem a $${third} slice and subscribe it back the following week, proving the wallet can use both sides of the product, then restore the full position.`,
  ];
  if (c.includes('stable')) return [
    `Mint or deposit $${capital} of ${name}'s stable asset on ${chain} against the collateral the app asks for, and hold the stable asset rather than swapping out immediately.`,
    `Provide $${third} of the stable asset to a paired liquidity pool named in ${name}'s app and keep that LP position for the rest of the campaign.`,
  ];
  if (c.includes('prediction')) return [
    `Fund ${name} with $${capital} and take small positions in at least three unrelated markets, sizing no single market above $${third}.`,
    `Settle one finished market, record the payout, and re-enter a new market with the proceeds so the wallet shows a full prediction lifecycle.`,
  ];
  if (c.includes('insurance')) return [
    `Buy $${capital} of cover from ${name} on ${chain} for a position this wallet actually holds, and keep the policy NFT or receipt for its full term.`,
    `Renew or extend the cover once before it lapses, and log the premium paid each time so the cost of the hedge is explicit.`,
  ];
  if (c.includes('chain')) return [
    `Bridge $${capital} to ${name}'s chain and make it the wallet's home chain for the campaign: pay every later fee in its native asset from this wallet.`,
    `Use three different applications on the chain (a swap, a lending market and one native app), one transaction each, so activity is spread rather than repeated in one contract.`,
  ];
  if (c.includes('privacy')) return [
    `Deposit $${capital} into ${name}'s shielded pool on ${chain} from the farming wallet and keep the note or commitment the app issues.`,
    `Make one shielded transfer of $${third} to a second wallet you control, then consolidate back, so both deposit and transfer paths are exercised.`,
  ];
  if (c.includes('index')) return [
    `Mint $${capital} of ${name}'s index token on ${chain} and hold it for the full campaign instead of trading in and out.`,
    `Mint a further $${third} after the next rebalance the app publishes, and log the basket change the rebalance made.`,
  ];
  if (c.includes('payment') || c.includes('card')) return [
    `Activate ${name} with $${capital} of working balance and route one real payment of about $${third} through it from the farming wallet.`,
    `Repeat a smaller payment in a later week and keep both receipts, so the wallet shows recurring use rather than a single test transaction.`,
  ];
  return [
    `Deposit $${capital} of USDC into ${name}'s main product on ${chain} and keep the position open for the whole campaign.`,
    `Withdraw 10% of the position and re-deposit it a week later, so the wallet registers both directions of flow with ${name}.`,
  ];
}

/** A compact TVL for prose: $2.75B, $513M, $900K. */
export function tvlText(tvl: number): string {
  if (tvl >= 1_000_000_000) return `$${(tvl / 1_000_000_000).toFixed(2)}B`;
  if (tvl >= 1_000_000) return `$${Math.round(tvl / 1_000_000)}M`;
  return `$${Math.round(tvl / 1_000)}K`;
}

/** A protocol's farm plan: seven steps, each with an explicit cost and time, plus the plan's totals. */
export function farmPlan(p: SnapshotProtocol, age: number | null): { capital: number; fees: number; weeks: number; steps: string[] } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const weeks = weeksFor(age);
  const holdDays = weeks * 7;
  const fees = gas * (weeks + 5);
  const [core, second] = actionsFor(p, capital, chain);
  const steps = [
    `Open ${p.name}'s own app from its official documentation, confirm the contract and that ${chain} is the network behind its ${tvlText(p.tvl_usd)} snapshot TVL, and start a farm log with the date, the wallet and this plan. Cost: $0 in fees. Time: 20 minutes.`,
    `Create a fresh wallet used only for ${p.name}, back up its seed phrase offline, and fund it with $${capital} of working capital plus $${gas * 6} of ${chain} gas money. Cost: about $${gas} network fee to fund. Time: 10 minutes.`,
    `${core} Cost: $${capital} of capital plus about $${gas} of gas. Time: 25 minutes.`,
    `${second} Cost: about $${gas} of gas. Time: 15 minutes.`,
    `Repeat one qualifying action every week for ${weeks} weeks, alternating the core and second steps, and keep the position open across at least ${weeks} weekly snapshots. Cost: about $${gas} of gas a week, $${gas * weeks} in all. Time: 10 minutes a week.`,
    `Every second week, open ${p.name}'s official points or rewards page, write the balance it shows for this wallet into the farm log, and never pay a third party to claim: a real claim is announced inside the app itself. Cost: $0. Time: 15 minutes.`,
    `Exit when a token launch is announced inside the app or after ${holdDays} days, whichever comes first: unwind in two transactions a day apart to limit slippage, then sweep the proceeds back to the funding wallet. Cost: about $${gas * 2} of gas plus normal market slippage. Time: 30 minutes.`,
  ];
  return { capital, fees, weeks, steps };
}

/** The live-token protocols, by market cap, for the dashboard's Live view and calibration table. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    category_median_multiple: row.model.category_median_multiple,
    calibration_n: row.model.calibration_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_capital_usd: row.farm_plan.capital_usd,
    farm_fees_usd: row.farm_plan.est_fees_usd,
    farm_weeks: row.farm_plan.weeks,
    farm_steps: row.farm_steps,
  };
}

/** The pre-token records above the floor that are neither ranked nor live: the set-aside view. */
export function setAside(snapshot: Snapshot, board: BoardRow[]): { rows: AsideRow[]; total: number } {
  const ranked = new Set(board.map((r) => r.slug));
  const all = snapshot.protocols
    .filter((p) => isPreToken(p) && !ranked.has(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  return {
    total: all.length,
    rows: all.slice(0, LIVE_ROWS).map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
    })),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const calibration = calibrate(snapshot, model);
  const live = liveRows(snapshot);
  const aside = setAside(snapshot, board);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: calibration.global_multiple,
    calibration_live_n: calibration.live_n,
    unknown_age_days: calibration.unknown_age_days,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    calibration: calibration.categories,
    rows: board.map(radarRow),
    live,
    aside: aside.rows,
    aside_size: aside.total,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
