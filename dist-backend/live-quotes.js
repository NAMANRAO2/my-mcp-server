/**
 * Live market data for the current portfolio's equity/ETF holdings, via Finnhub's WebSocket trade
 * stream, plus a simulated ticker for the one F&O position (NIFTYCE) that no free API can serve —
 * genuine Indian derivatives data needs a paid, broker-linked feed (Kite Connect, Upstox, etc.).
 *
 * Deliberately scoped to the symbols actually held (AAPL, MSFT, NVDA, JNJ, PG, XOM, VOO), not a
 * general "look up any ticker" service — this mirrors the user's own instruction to take the
 * existing portfolio's data live rather than build a broader market data platform.
 *
 * Degrades gracefully with no API key: everything downstream reads getLiveQuote() and falls back
 * to the static mock quote whenever a symbol isn't in 'live' or 'simulated' mode, so a missing or
 * invalid key never breaks portfolio valuation — it just means prices don't move.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
const FINNHUB_KEY = process.env.FINNHUB_API_KEY?.trim();
const TRACKED_EQUITY_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'JNJ', 'PG', 'XOM', 'VOO'];
const SIMULATED_SYMBOL = 'NIFTYCE';
const SNAPSHOT_PATH = path.join(process.cwd(), 'logs', 'live-quotes.json');
export const liveEvents = new EventEmitter();
const quotes = new Map();
const previousClose = new Map();
function writeSnapshot() {
    try {
        fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
        fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify([...quotes.values()], null, 2), 'utf-8');
    }
    catch {
        /* non-fatal — the MCP server just won't see live prices this tick */
    }
}
function emitTick(q) {
    quotes.set(q.symbol, q);
    liveEvents.emit('tick', q);
    writeSnapshot();
}
export function getLiveQuote(symbol) {
    return quotes.get(symbol.toUpperCase());
}
export function getAllLiveQuotes() {
    return [...quotes.values()];
}
export function getLiveStatus() {
    const tracked = [...quotes.values()];
    const keyConfigured = !!FINNHUB_KEY;
    return {
        key_configured: keyConfigured,
        tracked_symbols: [...TRACKED_EQUITY_SYMBOLS, SIMULATED_SYMBOL],
        quotes: tracked,
        overall_mode: !keyConfigured
            ? 'mock'
            : tracked.some((q) => TRACKED_EQUITY_SYMBOLS.includes(q.symbol) && q.mode === 'error')
                ? 'degraded'
                : 'live'
    };
}
/** Only 'live' and 'simulated' quotes are safe to use for valuation — 'error' entries carry no usable price. */
export function resolveQuote(symbol, mockPrice, mockDayChangePct) {
    const live = getLiveQuote(symbol);
    if (live && (live.mode === 'live' || live.mode === 'simulated')) {
        return { price: live.price, day_change_pct: live.day_change_pct, mode: live.mode };
    }
    return { price: mockPrice, day_change_pct: mockDayChangePct, mode: 'mock' };
}
// ---------------------------------------------------------------------------
// Finnhub — real equities/ETFs
// ---------------------------------------------------------------------------
async function fetchPreviousCloseAndSeed(symbol) {
    try {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const data = (await res.json());
        if (!data.pc)
            throw new Error('no previous close in response — check the API key and symbol');
        emitTick({ symbol, price: data.c, day_change_pct: data.dp, mode: 'live', updated_at: new Date().toISOString() });
        return data.pc;
    }
    catch (err) {
        emitTick({
            symbol,
            price: 0,
            day_change_pct: 0,
            mode: 'error',
            updated_at: new Date().toISOString(),
            note: err.message
        });
        return null;
    }
}
let ws = null;
let reconnectTimer = null;
function connectFinnhubWebSocket() {
    if (!FINNHUB_KEY)
        return;
    ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);
    ws.on('open', () => {
        console.log('📡 [LiveQuotes] Finnhub WebSocket connected — subscribing to held symbols');
        for (const symbol of TRACKED_EQUITY_SYMBOLS) {
            ws?.send(JSON.stringify({ type: 'subscribe', symbol }));
        }
    });
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type !== 'trade' || !Array.isArray(msg.data))
                return;
            for (const trade of msg.data) {
                const pc = previousClose.get(trade.s);
                if (!pc)
                    continue; // no seeded baseline for this symbol yet — skip rather than guess
                emitTick({
                    symbol: trade.s,
                    price: trade.p,
                    day_change_pct: Number((((trade.p - pc) / pc) * 100).toFixed(2)),
                    mode: 'live',
                    updated_at: new Date(trade.t).toISOString()
                });
            }
        }
        catch {
            /* malformed frame — ignore this one message, keep the connection */
        }
    });
    ws.on('close', () => {
        console.log('📡 [LiveQuotes] Finnhub WebSocket closed — reconnecting in 5s');
        scheduleReconnect();
    });
    ws.on('error', (err) => {
        console.error('📡 [LiveQuotes] Finnhub WebSocket error:', err.message);
    });
}
function scheduleReconnect() {
    if (reconnectTimer)
        return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectFinnhubWebSocket();
    }, 5000);
}
// ---------------------------------------------------------------------------
// NIFTYCE — simulated (no free real Indian F&O feed exists)
// ---------------------------------------------------------------------------
function startNiftySimulator(startPrice, startDayChangePct) {
    let price = startPrice;
    // Derive an implied "previous close" from the seeded day-change so the walk has a fixed
    // reference point — this is what keeps day_change_pct meaningful as price drifts tick to tick.
    const impliedPreviousClose = startPrice / (1 + startDayChangePct / 100);
    const tick = () => {
        const driftPct = (Math.random() - 0.5) * 6; // +/-3% swing per tick — options are volatile
        price = Math.max(0.5, price * (1 + driftPct / 100));
        emitTick({
            symbol: SIMULATED_SYMBOL,
            price: Number(price.toFixed(2)),
            day_change_pct: Number((((price - impliedPreviousClose) / impliedPreviousClose) * 100).toFixed(2)),
            mode: 'simulated',
            updated_at: new Date().toISOString(),
            note: 'Simulated. Real-time Indian F&O data requires a paid, broker-linked feed (e.g. Kite Connect, Upstox) — not available on any free API.'
        });
    };
    tick();
    setInterval(tick, 2000);
}
// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
export async function initLiveQuotes(mockNiftyQuote) {
    startNiftySimulator(mockNiftyQuote.price, mockNiftyQuote.day_change_pct);
    if (!FINNHUB_KEY) {
        console.log('📡 [LiveQuotes] No FINNHUB_API_KEY set — equities stay on mock quotes. Get a free key at https://finnhub.io/register');
        return;
    }
    console.log('📡 [LiveQuotes] FINNHUB_API_KEY found — fetching baseline quotes for held symbols...');
    const results = await Promise.all(TRACKED_EQUITY_SYMBOLS.map((s) => fetchPreviousCloseAndSeed(s)));
    results.forEach((pc, i) => {
        if (pc)
            previousClose.set(TRACKED_EQUITY_SYMBOLS[i], pc);
    });
    const ok = results.filter(Boolean).length;
    console.log(`📡 [LiveQuotes] ${ok}/${TRACKED_EQUITY_SYMBOLS.length} symbols seeded — connecting WebSocket for live ticks`);
    connectFinnhubWebSocket();
}
//# sourceMappingURL=live-quotes.js.map