"""Cross-symbol comparison analysis for the Yahoohoo sandbox.

Expects DATA with: symbols, benchmark, quotes, history, summaries, options.
Builds pairwise relative-strength matrices, tracking error, information ratio,
upside/downside capture, and regime labeling on top of standard metrics.

Sets RESULT to a dict with per-symbol metrics, cross-section, pairwise matrix,
and benchmark comparisons.
"""

from math import sqrt
from statistics import pstdev, mean, median


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
    downside_returns = [r for r in returns if r < 0]
    downside_vol = pstdev(downside_returns) * sqrt(252) if len(downside_returns) >= 2 else None
    avg_volume = mean([row['volume'] for row in rows if row.get('volume') is not None]) if rows else None
    sma20 = mean(closes[-20:]) if len(closes) >= 20 else None
    sma50 = mean(closes[-50:]) if len(closes) >= 50 else None

    sharpe = safe_div(total_return, realized_vol)
    sortino = safe_div(total_return, downside_vol)

    return {
        'bars': len(rows),
        'start': rows[0]['date'][:10] if rows else None,
        'end': rows[-1]['date'][:10] if rows else None,
        'first_close': closes[0] if closes else None,
        'last_close': closes[-1] if closes else None,
        'total_return': total_return,
        'realized_vol_annualized': realized_vol,
        'downside_vol_annualized': downside_vol,
        'max_drawdown': max_drawdown(closes),
        'sharpe_ratio': sharpe,
        'sortino_ratio': sortino,
        'avg_volume': avg_volume,
        'sma20': sma20,
        'sma50': sma50,
        'trend_vs_sma20': (closes[-1] / sma20 - 1.0) if closes and sma20 else None,
        'trend_vs_sma50': (closes[-1] / sma50 - 1.0) if closes and sma50 else None,
        'positive_days_pct': (len([r for r in returns if r > 0]) / len(returns)) if returns else None,
        'median_daily_return': median(returns) if returns else None,
    }


def compute_capture_ratios(sym_returns, bench_returns):
    """Upside and downside capture vs benchmark."""
    up_sym, up_bench = [], []
    down_sym, down_bench = [], []
    for sr, br in zip(sym_returns, bench_returns):
        if br > 0:
            up_sym.append(sr)
            up_bench.append(br)
        elif br < 0:
            down_sym.append(sr)
            down_bench.append(br)
    upside_capture = safe_div(mean(up_sym), mean(up_bench)) if up_sym and up_bench else None
    downside_capture = safe_div(mean(down_sym), mean(down_bench)) if down_sym and down_bench else None
    return upside_capture, downside_capture


def compute_tracking_error(sym_returns, bench_returns):
    """Annualized tracking error."""
    if len(sym_returns) < 2 or len(sym_returns) != len(bench_returns):
        return None
    excess = [s - b for s, b in zip(sym_returns, bench_returns)]
    return pstdev(excess) * sqrt(252)


def compute_information_ratio(sym_total, bench_total, tracking_error):
    """Information ratio = excess return / tracking error."""
    if sym_total is None or bench_total is None or tracking_error in (None, 0):
        return None
    return (sym_total - bench_total) / tracking_error


def label_regime(total_return, realized_vol, max_dd):
    """Simple regime label based on return/vol/drawdown profile."""
    if total_return is None or realized_vol is None:
        return 'insufficient_data'
    if total_return > 0.10 and realized_vol < 0.20:
        return 'low_vol_rally'
    if total_return > 0.10 and realized_vol >= 0.20:
        return 'high_vol_rally'
    if total_return < -0.10 and realized_vol >= 0.25:
        return 'selloff'
    if abs(total_return) <= 0.05 and realized_vol < 0.15:
        return 'quiet_range'
    if max_dd is not None and max_dd < -0.20:
        return 'drawdown_recovery' if total_return > 0 else 'deep_drawdown'
    return 'mixed'


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


# --- Main execution ---
quotes = DATA.get('quotes', {})
history = DATA.get('history', {})
summaries = DATA.get('summaries', {})
benchmark = DATA.get('benchmark')

symbols = dedupe_symbols(DATA.get('symbols', []))
metrics = {'symbols': {}, 'benchmark': benchmark, 'comparisons': {}, 'cross_section': None, 'pairwise': {}}

for symbol in symbols:
    hist = history.get(symbol, [])
    metrics['symbols'][symbol] = {
        'quote': quotes.get(symbol),
        'history': summarize_history(hist) if hist else {'bars': 0},
        'fundamentals': summarize_fundamentals(summaries.get(symbol)),
    }
    h = metrics['symbols'][symbol]['history']
    h['regime'] = label_regime(h.get('total_return'), h.get('realized_vol_annualized'), h.get('max_drawdown'))

benchmark_history = summarize_history(history.get(benchmark, [])) if benchmark and benchmark in history else None
benchmark_total_return = benchmark_history.get('total_return') if benchmark_history else None

# Benchmark comparisons with capture ratios and tracking error
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
        upside_cap, downside_cap = compute_capture_ratios(xs, ys)
        te = compute_tracking_error(xs, ys)
        sym_total = metrics['symbols'].get(symbol, {}).get('history', {}).get('total_return')
        ir = compute_information_ratio(sym_total, benchmark_total_return, te)
        metrics['comparisons'][f'{symbol}_vs_{benchmark}'] = {
            'paired_observations': len(pairs),
            'correlation': corr(xs, ys),
            'beta': beta,
            'upside_capture': upside_cap,
            'downside_capture': downside_cap,
            'tracking_error': te,
            'information_ratio': ir,
        }

# Pairwise relative strength matrix
if len(symbols) > 1:
    for i, sym_a in enumerate(symbols):
        for sym_b in symbols[i+1:]:
            rows_a = history.get(sym_a, [])
            rows_b = history.get(sym_b, [])
            if not rows_a or not rows_b:
                continue
            pairs = paired_returns(rows_a, rows_b)
            xs = [p[0] for p in pairs]
            ys = [p[1] for p in pairs]
            ret_a = metrics['symbols'].get(sym_a, {}).get('history', {}).get('total_return')
            ret_b = metrics['symbols'].get(sym_b, {}).get('history', {}).get('total_return')
            metrics['pairwise'][f'{sym_a}_vs_{sym_b}'] = {
                'correlation': corr(xs, ys) if xs else None,
                'relative_return': (ret_a - ret_b) if ret_a is not None and ret_b is not None else None,
                'paired_observations': len(pairs),
            }

# Cross-section scorecard
scorecard = []
coverage_warnings = []
for symbol in symbols:
    h = (metrics.get('symbols', {}).get(symbol, {}) or {}).get('history', {}) or {}
    bars = h.get('bars') or 0
    total_return = h.get('total_return')
    realized_vol = h.get('realized_vol_annualized')
    drawdown = h.get('max_drawdown')
    scorecard.append({
        'symbol': symbol,
        'bars': bars,
        'last_close': h.get('last_close'),
        'total_return': total_return,
        'realized_vol_annualized': realized_vol,
        'max_drawdown': drawdown,
        'sharpe_ratio': h.get('sharpe_ratio'),
        'sortino_ratio': h.get('sortino_ratio'),
        'risk_adjusted_return': safe_div(total_return, realized_vol),
        'return_over_drawdown': safe_div(total_return, abs(drawdown) if drawdown not in (None, 0) else None),
        'excess_return_vs_benchmark': (
            total_return - benchmark_total_return
            if total_return is not None and benchmark_total_return is not None
            else None
        ),
        'regime': h.get('regime'),
    })
    if bars < 5:
        coverage_warnings.append(f'{symbol} has limited history ({bars} bars).')

rankings = {
    'by_total_return': rank_scorecard(scorecard, 'total_return', reverse=True),
    'by_sharpe': rank_scorecard(scorecard, 'sharpe_ratio', reverse=True),
    'by_sortino': rank_scorecard(scorecard, 'sortino_ratio', reverse=True),
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
    'best_sharpe': 'by_sharpe',
    'best_sortino': 'by_sortino',
    'best_risk_adjusted_return': 'by_risk_adjusted_return',
    'best_return_over_drawdown': 'by_return_over_drawdown',
    'lowest_volatility': 'by_lowest_volatility',
    'shallowest_drawdown': 'by_shallowest_drawdown',
    'best_excess_return_vs_benchmark': 'by_excess_return_vs_benchmark',
}
for leader_name, ranking_name in mapping.items():
    ranking = rankings.get(ranking_name) or []
    leaders[leader_name] = ranking[0] if ranking else None

metrics['cross_section'] = {
    'symbol_count': len(symbols),
    'benchmark_symbol': benchmark,
    'benchmark_total_return': benchmark_total_return,
    'scorecard': scorecard,
    'rankings': rankings,
    'leaders': leaders,
    'coverage_warnings': coverage_warnings,
}

RESULT = metrics
