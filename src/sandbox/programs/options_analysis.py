"""Options-focused analysis for the Yahoohoo sandbox.

Expects DATA with: symbols, benchmark, quotes, history, options.
Computes term structure, skew metrics, put/call ratios, IV vs realized vol,
and concentration by strike/expiry.

Sets RESULT to a dict with per-symbol options metrics and history context.
"""

from math import sqrt
from statistics import pstdev, mean


def summarize_history(rows):
    rows = [row for row in rows if row.get('close') is not None]
    closes = [row['close'] for row in rows]
    returns = []
    for prev, curr in zip(closes, closes[1:]):
        if prev:
            returns.append((curr / prev) - 1.0)

    total_return = None
    if len(closes) >= 2 and closes[0]:
        total_return = (closes[-1] / closes[0]) - 1.0

    realized_vol = pstdev(returns) * sqrt(252) if len(returns) >= 2 else None

    return {
        'bars': len(rows),
        'last_close': closes[-1] if closes else None,
        'total_return': total_return,
        'realized_vol_annualized': realized_vol,
        'max_drawdown': max_drawdown(closes),
    }


def max_drawdown(closes):
    peak = None
    worst = 0.0
    for close in closes:
        if close is None:
            continue
        peak = close if peak is None else max(peak, close)
        if peak:
            worst = min(worst, (close / peak) - 1.0)
    return worst


def analyze_options(options_payload, last_close):
    if not options_payload:
        return None

    calls = options_payload.get('calls') or []
    puts = options_payload.get('puts') or []
    all_contracts = calls + puts

    # Basic IV stats
    call_ivs = [c.get('impliedVolatility') for c in calls if c.get('impliedVolatility') is not None]
    put_ivs = [p.get('impliedVolatility') for p in puts if p.get('impliedVolatility') is not None]
    all_ivs = call_ivs + put_ivs

    # Open interest
    call_oi = sum((c.get('openInterest') or 0) for c in calls)
    put_oi = sum((p.get('openInterest') or 0) for p in puts)
    total_oi = call_oi + put_oi

    # Volume
    call_vol = sum((c.get('volume') or 0) for c in calls)
    put_vol = sum((p.get('volume') or 0) for p in puts)

    # Skew: compare OTM put IV vs OTM call IV
    otm_put_ivs = []
    otm_call_ivs = []
    if last_close:
        for p in puts:
            strike = p.get('strike')
            iv = p.get('impliedVolatility')
            if strike and iv and strike < last_close * 0.97:
                otm_put_ivs.append(iv)
        for c in calls:
            strike = c.get('strike')
            iv = c.get('impliedVolatility')
            if strike and iv and strike > last_close * 1.03:
                otm_call_ivs.append(iv)

    avg_otm_put_iv = mean(otm_put_ivs) if otm_put_ivs else None
    avg_otm_call_iv = mean(otm_call_ivs) if otm_call_ivs else None
    skew = None
    if avg_otm_put_iv is not None and avg_otm_call_iv is not None and avg_otm_call_iv > 0:
        skew = avg_otm_put_iv - avg_otm_call_iv

    # ATM IV (strikes within 2% of last close)
    atm_ivs = []
    if last_close:
        for contract in all_contracts:
            strike = contract.get('strike')
            iv = contract.get('impliedVolatility')
            if strike and iv and abs(strike - last_close) / last_close < 0.02:
                atm_ivs.append(iv)

    # Concentration by strike
    strike_oi = {}
    for contract in all_contracts:
        strike = contract.get('strike')
        oi = contract.get('openInterest') or 0
        if strike:
            strike_oi[strike] = strike_oi.get(strike, 0) + oi
    top_strikes = sorted(strike_oi.items(), key=lambda x: -x[1])[:5]

    return {
        'sampled_calls': len(calls),
        'sampled_puts': len(puts),
        'avg_call_iv': mean(call_ivs) if call_ivs else None,
        'avg_put_iv': mean(put_ivs) if put_ivs else None,
        'avg_iv': mean(all_ivs) if all_ivs else None,
        'atm_iv': mean(atm_ivs) if atm_ivs else None,
        'skew': skew,
        'avg_otm_put_iv': avg_otm_put_iv,
        'avg_otm_call_iv': avg_otm_call_iv,
        'put_call_oi_ratio': (put_oi / call_oi) if call_oi > 0 else None,
        'put_call_volume_ratio': (put_vol / call_vol) if call_vol > 0 else None,
        'total_open_interest': total_oi,
        'total_volume': call_vol + put_vol,
        'top_strikes_by_oi': [{'strike': s, 'oi': oi} for s, oi in top_strikes],
        'expirations': options_payload.get('expirationDates') or [],
    }


def dedupe_symbols(values):
    symbols = []
    seen = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        symbols.append(value)
    return symbols


# --- Main execution ---
quotes = DATA.get('quotes', {})
hist_data = DATA.get('history', {})
options_data = DATA.get('options', {})

symbols = dedupe_symbols(DATA.get('symbols', []))
metrics = {'symbols': {}, 'benchmark': DATA.get('benchmark')}

for symbol in symbols:
    hist = hist_data.get(symbol, [])
    h = summarize_history(hist) if hist else {'bars': 0, 'last_close': None}
    last_close = h.get('last_close')

    opts = analyze_options(options_data.get(symbol), last_close)

    # IV vs realized vol
    iv_vs_rv = None
    if opts and opts.get('atm_iv') is not None and h.get('realized_vol_annualized') is not None:
        rv = h['realized_vol_annualized']
        iv = opts['atm_iv']
        iv_vs_rv = {
            'implied_vol': iv,
            'realized_vol': rv,
            'vol_premium': iv - rv,
            'vol_premium_pct': ((iv / rv) - 1.0) if rv > 0 else None,
        }

    metrics['symbols'][symbol] = {
        'quote': quotes.get(symbol),
        'history': h,
        'options': opts,
        'iv_vs_realized': iv_vs_rv,
    }

RESULT = metrics
