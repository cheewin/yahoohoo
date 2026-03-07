"""Standard market-metrics analysis program for the Yahoohoo sandbox.

Expects DATA with: symbols, benchmark, quotes, history, summaries, options.
Sets RESULT to a dict of per-symbol metrics, benchmark comparisons, etc.

This file is loaded by the Node orchestrator and sent to runner.py for execution.
It can also be tested standalone with a fixture payload.
"""

from math import sqrt
from statistics import pstdev, mean


def paired_returns(primary, secondary):
    left = {row['date'][:10]: row['close'] for row in primary if row.get('close') is not None}
    right = {row['date'][:10]: row['close'] for row in secondary if row.get('close') is not None}
    dates = sorted(set(left) & set(right))
    pairs = []
    for prev, curr in zip(dates, dates[1:]):
        a0, a1 = left.get(prev), left.get(curr)
        b0, b1 = right.get(prev), right.get(curr)
        if a0 and a1 and b0 and b1 and a0 != 0 and b0 != 0:
            pairs.append(((a1 / a0) - 1.0, (b1 / b0) - 1.0))
    return pairs


def variance(values):
    if not values:
        return None
    mu = mean(values)
    return sum((v - mu) ** 2 for v in values) / len(values)


def covariance(xs, ys):
    if not xs or len(xs) != len(ys):
        return None
    mux = mean(xs)
    muy = mean(ys)
    return sum((x - mux) * (y - muy) for x, y in zip(xs, ys)) / len(xs)


def corr(xs, ys):
    vx = variance(xs)
    vy = variance(ys)
    if vx in (None, 0) or vy in (None, 0):
        return None
    return covariance(xs, ys) / sqrt(vx * vy)


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


def safe_div(numerator, denominator):
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


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
    avg_volume = mean([row['volume'] for row in rows if row.get('volume') is not None]) if rows else None
    sma20 = mean(closes[-20:]) if len(closes) >= 20 else None
    sma50 = mean(closes[-50:]) if len(closes) >= 50 else None

    return {
        'bars': len(rows),
        'start': rows[0]['date'][:10] if rows else None,
        'end': rows[-1]['date'][:10] if rows else None,
        'first_close': closes[0] if closes else None,
        'last_close': closes[-1] if closes else None,
        'total_return': total_return,
        'realized_vol_annualized': realized_vol,
        'max_drawdown': max_drawdown(closes),
        'avg_volume': avg_volume,
        'sma20': sma20,
        'sma50': sma50,
        'trend_vs_sma20': (closes[-1] / sma20 - 1.0) if closes and sma20 else None,
        'trend_vs_sma50': (closes[-1] / sma50 - 1.0) if closes and sma50 else None,
    }


def summarize_options(options_payload):
    if not options_payload:
        return None
    calls = options_payload.get('calls') or []
    puts = options_payload.get('puts') or []
    ivs = [row.get('impliedVolatility') for row in calls[:20] + puts[:20] if row.get('impliedVolatility') is not None]
    open_interest = sum((row.get('openInterest') or 0) for row in calls[:20] + puts[:20])
    call_oi = sum((row.get('openInterest') or 0) for row in calls[:20])
    put_oi = sum((row.get('openInterest') or 0) for row in puts[:20])
    return {
        'sampled_contracts': len(calls[:20]) + len(puts[:20]),
        'avg_implied_volatility': mean(ivs) if ivs else None,
        'open_interest': open_interest,
        'put_call_oi_ratio': (put_oi / call_oi) if call_oi else None,
        'expirations': options_payload.get('expirationDates') or [],
    }


def summarize_fundamentals(summary_payload):
    if not summary_payload:
        return None
    sd = summary_payload.get('summaryDetail') or {}
    fd = summary_payload.get('financialData') or {}
    ks = summary_payload.get('defaultKeyStatistics') or {}
    price = summary_payload.get('price') or {}
    return {
        'market_cap': sd.get('marketCap') or price.get('marketCap'),
        'trailing_pe': sd.get('trailingPE') or price.get('trailingPE'),
        'forward_pe': sd.get('forwardPE'),
        'dividend_yield': sd.get('dividendYield'),
        'profit_margins': fd.get('profitMargins'),
        'operating_margins': fd.get('operatingMargins'),
        'return_on_equity': fd.get('returnOnEquity'),
        'beta': ks.get('beta'),
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


def rank_scorecard(scorecard, field, *, reverse=True):
    rows = [{'symbol': row['symbol'], 'value': row.get(field)} for row in scorecard if row.get(field) is not None]
    if reverse:
        rows.sort(key=lambda row: (-row['value'], row['symbol']))
    else:
        rows.sort(key=lambda row: (row['value'], row['symbol']))
    return rows


def build_cross_section(symbols, metrics, benchmark_history):
    benchmark_total_return = benchmark_history.get('total_return') if benchmark_history else None
    scorecard = []
    coverage_warnings = []

    for symbol in symbols:
        history = (metrics.get('symbols', {}).get(symbol, {}) or {}).get('history', {}) or {}
        bars = history.get('bars') or 0
        total_return = history.get('total_return')
        realized_vol = history.get('realized_vol_annualized')
        drawdown = history.get('max_drawdown')
        scorecard.append({
            'symbol': symbol,
            'bars': bars,
            'last_close': history.get('last_close'),
            'total_return': total_return,
            'realized_vol_annualized': realized_vol,
            'max_drawdown': drawdown,
            'risk_adjusted_return': safe_div(total_return, realized_vol),
            'return_over_drawdown': safe_div(total_return, abs(drawdown) if drawdown not in (None, 0) else None),
            'excess_return_vs_benchmark': (
                total_return - benchmark_total_return
                if total_return is not None and benchmark_total_return is not None
                else None
            ),
        })
        if bars < 5:
            coverage_warnings.append(f'{symbol} has limited history ({bars} bars).')

    rankings = {
        'by_total_return': rank_scorecard(scorecard, 'total_return', reverse=True),
        'by_risk_adjusted_return': rank_scorecard(scorecard, 'risk_adjusted_return', reverse=True),
        'by_return_over_drawdown': rank_scorecard(scorecard, 'return_over_drawdown', reverse=True),
        'by_lowest_volatility': rank_scorecard(scorecard, 'realized_vol_annualized', reverse=False),
        'by_shallowest_drawdown': rank_scorecard(scorecard, 'max_drawdown', reverse=True),
    }
    if benchmark_total_return is not None:
        rankings['by_excess_return_vs_benchmark'] = rank_scorecard(scorecard, 'excess_return_vs_benchmark', reverse=True)

    leaders = {}
    mapping = {
        'best_total_return': 'by_total_return',
        'best_risk_adjusted_return': 'by_risk_adjusted_return',
        'best_return_over_drawdown': 'by_return_over_drawdown',
        'lowest_volatility': 'by_lowest_volatility',
        'shallowest_drawdown': 'by_shallowest_drawdown',
        'best_excess_return_vs_benchmark': 'by_excess_return_vs_benchmark',
    }
    for leader_name, ranking_name in mapping.items():
        ranking = rankings.get(ranking_name) or []
        leaders[leader_name] = ranking[0] if ranking else None

    return {
        'symbol_count': len(symbols),
        'benchmark_symbol': DATA.get('benchmark'),
        'benchmark_total_return': benchmark_total_return,
        'scorecard': scorecard,
        'rankings': rankings,
        'leaders': leaders,
        'coverage_warnings': coverage_warnings,
    }


# --- Main execution ---
quotes = DATA.get('quotes', {})
history = DATA.get('history', {})
options_data = DATA.get('options', {})
summaries = DATA.get('summaries', {})
benchmark = DATA.get('benchmark')

symbols = dedupe_symbols(DATA.get('symbols', []))
metrics = {'symbols': {}, 'benchmark': benchmark, 'comparisons': {}, 'cross_section': None}

for symbol in symbols:
    hist = history.get(symbol, [])
    metrics['symbols'][symbol] = {
        'quote': quotes.get(symbol),
        'history': summarize_history(hist) if hist else {'bars': 0},
        'options': summarize_options(options_data.get(symbol)),
        'fundamentals': summarize_fundamentals(summaries.get(symbol)),
    }

benchmark_history = summarize_history(history.get(benchmark, [])) if benchmark and benchmark in history else None

if benchmark and benchmark in history:
    bench_rows = history.get(benchmark, [])
    for symbol in symbols:
        if symbol == benchmark:
            continue
        sym_rows = history.get(symbol, [])
        if not sym_rows:
            continue
        pairs = paired_returns(sym_rows, bench_rows)
        xs = [p[0] for p in pairs]
        ys = [p[1] for p in pairs]
        beta = None
        bench_var = variance(ys)
        cov = covariance(xs, ys)
        if bench_var not in (None, 0) and cov is not None:
            beta = cov / bench_var
        metrics['comparisons'][f'{symbol}_vs_{benchmark}'] = {
            'paired_observations': len(pairs),
            'correlation': corr(xs, ys),
            'beta': beta,
        }

if len(symbols) > 1:
    metrics['cross_section'] = build_cross_section(symbols, metrics, benchmark_history)

RESULT = metrics
