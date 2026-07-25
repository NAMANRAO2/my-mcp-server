/**
 * Data access for the Portfolio Guardian.
 *
 * All datasets are fabricated mock data shipped as JSON under `src/data/`. They are read from
 * disk once and cached in memory. The decision log is the only mutable dataset: it lives in
 * memory for the session and is best-effort appended to `logs/decision-log.jsonl`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The JSON datasets are not TypeScript modules, so they are not emitted into `dist/` by the
 * compiler. Resolve against every plausible location so the same code works when run from
 * source (dev) and from the build output (prod), regardless of the working directory.
 */
function resolveDataFile(fileName: string): string {
  const candidates = [
    path.join(process.cwd(), 'src', 'data', fileName),
    path.join(process.cwd(), 'dist', 'data', fileName),
    path.join(process.cwd(), 'data', fileName),
    path.join(HERE, '..', '..', 'data', fileName),
    path.join(HERE, '..', '..', '..', 'src', 'data', fileName)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Guardian dataset "${fileName}" not found. Looked in:\n  ${candidates.join('\n  ')}`
  );
}

function loadJson<T>(fileName: string): T {
  return JSON.parse(fs.readFileSync(resolveDataFile(fileName), 'utf-8')) as T;
}

function memo<T>(load: () => T): () => T {
  let cached: T | undefined;
  return () => (cached ??= load());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Holding {
  symbol: string;
  name: string;
  sector: string;
  quantity: number;
  avg_price: number;
  purchase_date: string;
  thesis: string;
}

export interface Portfolio {
  user_id: string;
  currency: string;
  as_of: string;
  profile: {
    display_name: string;
    experience: string;
    started_investing: string;
    stated_horizon_years: number;
    stated_goal: string;
    monthly_contribution: number;
  };
  cash: number;
  holdings: Holding[];
}

export interface Quote {
  price: number;
  day_change_pct: number;
  week_change_pct: number;
  year_change_pct: number;
}

export interface MarketEvent {
  id: string;
  date: string;
  type: string;
  scope: string;
  headline: string;
  summary: string;
  affects_sectors: string[];
  affects_symbols: string[];
  sentiment: 'positive' | 'negative' | 'neutral';
  flags?: string[];
}

export interface MarketData {
  as_of: string;
  quotes: Record<string, Quote>;
  indices: Record<string, { day_change_pct: number; week_change_pct: number }>;
  sector_moves: Record<string, number>;
  events: MarketEvent[];
}

export interface BiasSignal {
  id: string;
  weight: number;
  description: string;
  phrases: string[];
}

export interface BiasPattern {
  id: 'panic_sell' | 'fomo_buy' | 'herd_follow';
  label: string;
  description: string;
  historical_key: string;
  reflection_focus: string;
  gate: BiasSignal;
  signals: BiasSignal[];
}

export interface BiasDictionary {
  version: string;
  thresholds: { intervene: number; watch: number };
  patterns: BiasPattern[];
  deliberation_markers: { penalty: number; description: string; phrases: string[] };
  informational_markers: { description: string; phrases: string[] };
  banned_advice_phrases: { description: string; phrases: string[] };
}

export interface HistoricalCase {
  id: string;
  case: string;
  event_types: string[];
  note?: string;
  [key: string]: unknown;
}

export interface HistoricalPatternGroup {
  label: string;
  aggregate: Record<string, unknown> & { plain_language: string; sample_size: number };
  cases: HistoricalCase[];
}

export type HistoricalPatterns = Record<string, HistoricalPatternGroup> & {
  _disclaimer: string;
};

// ---------------------------------------------------------------------------
// Cached dataset accessors
// ---------------------------------------------------------------------------

export const getPortfolio = memo(() => loadJson<Portfolio>('portfolio.json'));
export const getMarketData = memo(() => loadJson<MarketData>('market-events.json'));
export const getBiasDictionary = memo(() => loadJson<BiasDictionary>('bias-signal-patterns.json'));
export const getHistoricalPatterns = memo(() => loadJson<HistoricalPatterns>('historical-patterns.json'));

export const DATA_DISCLAIMER =
  'All portfolio, price and historical figures in this server are fabricated mock data for demonstration. Nothing here is investment advice.';

// ---------------------------------------------------------------------------
// Decision log (mutable)
// ---------------------------------------------------------------------------

export interface DecisionLogEntry {
  decision_id: string;
  logged_at: string;
  user_id: string;
  user_intent: string;
  detected_pattern: string | null;
  confidence: number | null;
  context_shown: Record<string, unknown>;
  user_decision: string;
  user_note?: string;
}

const decisionLog: DecisionLogEntry[] = [];
let decisionCounter = 0;

export function nextDecisionId(): string {
  decisionCounter += 1;
  return `DEC-${String(decisionCounter).padStart(4, '0')}`;
}

export function appendDecision(entry: DecisionLogEntry): DecisionLogEntry {
  decisionLog.push(entry);

  // Best-effort durable copy. A failure here must never break the tool call — the in-memory
  // log is the source of truth for the session.
  try {
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'decision-log.jsonl'), `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch {
    /* non-fatal */
  }

  return entry;
}

export function readDecisionLog(): DecisionLogEntry[] {
  return [...decisionLog];
}
