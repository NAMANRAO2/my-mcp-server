# Portfolio Guardian

**A behavioural guard for retail investors, built as a NitroStack MCP server.**

> We don't tell you what to do. We stop you doing something you'll regret.

Retail investors have more market data than ever and nothing that (a) explains what is actually
relevant to *their* portfolio right now, or (b) intervenes at the moment a bias is about to drive a
bad decision. Portfolio Guardian does both — and it never recommends a trade.

---

## The two layers

**Layer A — Contextual Relevance Engine.** Most market news touches any given portfolio not at all.
The Guardian scores every event against the user's actual holdings: which positions, what percentage
of their money, and — critically — whether the move is market-wide, sector-level, or genuinely
specific to a company they own. That last distinction is what defuses most panic-sells.

**Layer B — Behavioural Intervention Engine.** When the user states an intent to trade, the Guardian
checks it against three bias patterns, then puts the context, the historical base rate and one
reflective question in front of them *before* they act. They stay free to proceed. Proceeding is a
first-class button, not a grudging escape hatch.

## The compliance boundary

This is the design constraint the whole project is built around, not a disclaimer bolted on at the end:

| The Guardian does | The Guardian never does |
| --- | --- |
| Surfaces which holdings an event touches, and by how much | Says "buy", "sell", "hold", or "you should" |
| Names the bias pattern detected and the phrases that triggered it | Blocks or executes a trade |
| Shows what happened historically to people who decided this way | Predicts a price, a recovery, or a return |
| Asks exactly one reflective question, then stops | Assesses suitability or gives a financial plan |
| Logs everything shown, plus whatever the user chose | Overrides the user |

`generate_reflection_prompt` is the only tool that emits user-facing prose, and it **lints its own
output** against a list of banned directive phrases before returning. Every response carries the
compliance result — the intervention widget shows a "✓ No trade recommendation given" badge that is
computed, not decorative.

Two design details follow from the same principle:

- **The historical data includes counterweight cases** where the reactive decision turned out to be
  correct. Showing only the cases that support pausing would be advice wearing a costume.
- **Company-specific news is called out as such**, even though it makes selling look more reasonable.
  A guard that only ever argues for inaction is not a guard.

---

## The three bias patterns

| Pattern | Fires on | What gets surfaced |
| --- | --- | --- |
| `panic_sell` | sell intent + fear language + totality ("all", "everything") + urgency | Is this broad or company-specific? Recovery base rates; what past sellers locked in |
| `fomo_buy` | buy intent + social proof + hype reference + fear of missing out | What this does to concentration; outcomes of past crowded entries |
| `herd_follow` | trade intent justified by *someone else's* action, with no personal thesis | Their situation vs. yours; the lag between a signal and the price |

**Every pattern requires a trade-intent gate.** Emotional language alone can never fire an
intervention, and messages containing deliberation markers ("as planned", "rebalancing", "need the
cash for") are scored down. Informational questions cannot trigger anything at all.

That is the deliberate part: a missed nudge costs one decision, a false nudge costs the
relationship. See [scenario 3](#scenario-3--no-intervention) below.

---

## Architecture

```
src/
├── data/                              # mock datasets (all figures fabricated)
│   ├── portfolio.json                 # 7 holdings, cost basis, and the user's own written thesis per position
│   ├── market-events.json             # quotes, index/sector moves, 12 events — deliberately including noise
│   ├── historical-patterns.json       # base rates per bias pattern, with counterweight cases
│   └── bias-signal-patterns.json      # phrase dictionary, weights, gates, thresholds, banned-advice list
├── modules/guardian/
│   ├── guardian.store.ts              # dataset loading + the mutable decision log
│   ├── guardian.logic.ts              # pure reasoning: valuation, relevance, detection, reflection, lint
│   ├── portfolio.tools.ts             # get_portfolio_snapshot, get_position_thesis
│   ├── market.tools.ts                # get_market_context, check_relevance_score       (Layer A)
│   ├── behavior.tools.ts              # detect_behavioral_signal … log_decision_context (Layer B)
│   ├── guardian.resources.ts          # 7 MCP resources incl. the audit trail and operating rules
│   └── guardian.prompts.ts            # the agent system prompt + reflection templates
└── widgets/app/
    ├── portfolio-dashboard/           # holdings, allocation, relevance-scored feed
    └── intervention-modal/            # the cooling-off screen
```

The reasoning logic is deliberately kept pure and free of MCP concerns, so relevance scoring and
bias detection can be reasoned about — and tested — on their own.

### Tools

| Tool | Purpose |
| --- | --- |
| `get_portfolio_snapshot` | Holdings priced live: value, weights, sector breakdown, P/L, plus the relevance-scored feed. Renders the dashboard widget. |
| `get_position_thesis` | The reason the user *themselves* recorded for owning a position. The strongest material any reflection has. |
| `get_market_context` | Index, sector and holding-level moves, plus the event feed. Establishes breadth — is everything falling, or is this rotation? |
| `check_relevance_score` | **Layer A.** Exposure %, affected holdings, and broad vs. sector vs. company-specific. Accepts ad-hoc headlines the user pastes in. |
| `detect_behavioral_signal` | **Layer B.** Pattern, confidence, the exact phrases that matched, and an action band (intervene / watch / none). |
| `get_historical_pattern` | Base rates and comparable episodes, including the counterweight cases. |
| `generate_reflection_prompt` | Composes the intervention and lints itself for advice language. Renders the intervention widget. |
| `log_decision_context` | The audit trail: everything shown, and what the user chose. |

### Resources

`guardian://portfolio` · `guardian://portfolio/valued` · `guardian://market-events` ·
`guardian://historical-patterns` · `guardian://bias-signals` · `guardian://decision-log` ·
`guardian://operating-rules`

### Prompts

`portfolio_guardian_system` — the agent's operating instructions. **Load this first.**
`bias_reflection_template` · `explain_relevance`

---

## How the agentic loop works

The tool-call sequence is **not hard-coded anywhere in this server**. The tools are the hands; the
model reasoning over `portfolio_guardian_system` is the brain deciding which hand to use and when.
Each tool returns a `next_step` field describing what it learned and what would sensibly follow, so
the model steers on results rather than on a script.

A typical chain for *"Market crashing, sell all my tech stocks now"*:

```
detect_behavioral_signal   panic_sell · confidence 0.92 · action intervene
                           gate: sell intent ("sell") + emotional ("crashing")
                                 + totality ("all") + urgency ("now")
get_portfolio_snapshot     3 tech holdings = 39.2% of total value ($10,078)
get_market_context         NASDAQ -3.9%, tech -4.6% … but healthcare +1.1% and staples +0.3%
check_relevance_score      HIGH exposure, driver = sector, is_company_specific = FALSE
get_historical_pattern     comparable broad dips; ~2 in 3 sellers re-entered higher
generate_reflection_prompt "You wrote down a reason for each of these when you bought them —
                            AAPL: 'Wanted one large, cash-rich company I actually understand as
                            the anchor of the portfolio'. Has any of those reasons stopped being
                            true today, or has only the price changed?"
log_decision_context       DEC-0001 · full context + the user's choice
```

Nowhere in that output does the agent say *don't sell*. It reports facts, a base rate, and a question.

---

## Real-time data and paper trading

The standalone web app (`src/backend` + `frontend/`) can run on live market data instead of the
static mock quotes, and lets you execute trades against the demo portfolio itself.

**Live prices.** `src/backend/live-quotes.ts` opens a WebSocket to [Finnhub](https://finnhub.io)
for the portfolio's equity/ETF holdings (AAPL, MSFT, NVDA, JNJ, PG, XOM, VOO) and rebroadcasts
ticks to the browser over its own WebSocket at `/ws/live`. Deliberately scoped to the symbols
actually held, not a general market-data platform. Set `FINNHUB_API_KEY` in `.env` (free, no card,
at [finnhub.io/register](https://finnhub.io/register)) — without it, everything falls back to the
static mock quotes and says so, both in the server log and the dashboard's status badge.

**NIFTYCE is simulated, not real.** Genuine real-time Indian F&O (NSE options) data needs a paid,
broker-linked feed (Kite Connect, Upstox, etc.) — there is no free equivalent to Finnhub for
Indian derivatives. So NIFTYCE gets a local random-walk generator instead, clearly labelled
`simulated` everywhere it appears (API responses, the dashboard's quote badge). It behaves like a
live feed for demo purposes; it is not connected to any real market.

**Paper trading only.** The dashboard's Execute Trade panel calls `POST /api/execute-trade`,
which adjusts the demo portfolio's holdings and cash using the current live/mock price — a
weighted average price on a buy, proceeds credited to cash on a sell. Restricted to symbols
already in the portfolio, since those are the only ones with a price source at all. **This never
touches a real brokerage** — there is no order routing, no account link, no real money anywhere in
this path. The mutated state persists to `logs/portfolio-state.json` (gitignored) and survives a
restart, the same rehydrate-on-boot pattern used for the decision log. The MCP server reads the
same file, so a trade made through the web app is visible in NitroStudio too, without running a
second live-data connection.

## Quick start

```bash
npm install
npm run dev          # starts the MCP server for NitroStudio
npm run widget dev   # widget dev server on :3001 (optional)
```

Then in NitroStudio:

1. **Tools page** — run each tool individually and verify `Status: Success`.
2. **AI Chat** — load the `portfolio_guardian_system` prompt, then type one of the scenarios below.

```bash
npm run build        # compiles the server, bundles widgets, copies src/data into dist/
npm start            # production (dual transport)
```

---

## The three demo scenarios

### Scenario 1 — Panic sell

> "Market is crashing, sell all my tech stocks now"

`panic_sell`, confidence **0.92**, action **intervene**. The Guardian establishes that 39.2% of the
portfolio is exposed but the driver is *sector-level* — healthcare and staples are up on the same
day, so this is rotation rather than every asset falling at once. It quotes the user's own thesis
back at them and asks whether the reason changed or only the price.

### Scenario 2 — FOMO buy

> "Everyone's buying QBITX, it's up 180% this month — I want in now before it's too late"

`fomo_buy`, confidence **0.90**, action **intervene**. Note that the Guardian does *not* dismiss an
unheld stock as noise — it names the flags attached to the data (crowded trade, no earnings history,
high volatility), gives the base rate for late entries, includes the case where a crowded run-up
kept going, and asks: *if this had gone sideways for three months instead, would you still want to
own it?*

### Scenario 3 — No intervention

The one to test hardest. All of these return `none`, and none may produce a modal:

| Message | Result | Why |
| --- | --- | --- |
| "How's my portfolio doing?" | `none` (0.00) | No trade intent — the gate never opens |
| "Why is my account down today?" | `none` (0.00) | Informational, however anxious it sounds |
| "Should I be worried about the tech dip?" | `none` (0.00) | A question, not an intent |
| "I want to sell 5 shares of XOM as planned to rebalance" | `none` (0.05) | Gate opens, then deliberation markers score it down |
| "sell all my tech stocks" | `watch` (0.52) | Totality without fear or urgency — surface context, don't run a full intervention |

The `watch` band exists precisely so borderline cases get a sentence rather than a modal.

---

## Demo script (3 minutes)

| Time | Beat |
| --- | --- |
| 0:00–0:20 | **The problem.** Data everywhere, nothing personal — and nothing that stops a bad decision in the moment it is being made. |
| 0:20–0:40 | **The compliance framing.** We never recommend a trade. We surface context, base rates and one reflective question. That is the real constraint every behavioural-nudge fintech works inside, and it makes for a stronger product, not a weaker one. |
| 0:40–2:10 | **Scenario 1 live.** Narrate the tool calls as they fire. Land on the intervention modal — the exposure bar, the "sector-wide, not these companies" line, the historical card, the question. Point at the compliance badge. |
| 2:10–2:40 | **Scenario 2**, to show it generalises rather than being hardcoded to one case. Then **scenario 3** — "how's my portfolio doing" — and show that *nothing* fires. False positives are what kill products like this. |
| 2:40–3:00 | **MCP + agentic.** The tools are the hands; the LLM decides which to use and when. MCP is what lets one agent reach portfolio data, market data and historical data through a single uniform interface. |

---

## Data honesty

Every historical/behavioural figure in this project is **fabricated mock data** built for
demonstration. The historical episodes referenced are real (2020 crash, 2022 rate-hike selloff,
2021 meme-stock run) but the outcome numbers are illustrative rather than researched, and the
datasets say so in their own `_disclaimer` fields.

Prices can be genuinely live (via Finnhub, if `FINNHUB_API_KEY` is set — see
[Real-time data and paper trading](#real-time-data-and-paper-trading)), and trades against the
demo portfolio genuinely execute and persist. What still does not exist, anywhere in this project:
a real brokerage connection, real order routing, or real money. "Executing a trade" means editing
this demo's own JSON state using a real or simulated price — nothing is ever sent to a market.

## Scope

See [IDEA.md](IDEA.md) for the locked scope: what is in, what is deliberately out, and the
definition of done.

## Links

- Docs: <https://docs.nitrostack.ai>
- NitroStudio: <https://nitrostack.ai/studio>
