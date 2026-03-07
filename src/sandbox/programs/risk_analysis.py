"""Risk-focused analysis for the Yahoohoo sandbox.

Expects DATA with: symbols, benchmark, quotes, history.
Computes detailed risk metrics: drawdown series, tail risk, rolling volatility,
correlation matrix, beta decomposition, and stress period detection.

Sets RESULT to a dict with per-symbol risk metrics and cross-symbol risk.
"""

from math import sqrt, log, exp
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


def safe_div(numerator, denominator):
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def compute_returns(closes):
    returns = []
    for prev, curr in zip(closes, closes[1:]):
        if prev:
            returns.append((curr / prev) - 1.0)
    return returns


def drawdown_series(closes):
    """Returns list of drawdown values at each point."""
    peak = None
    dd = []
    for close in closes:
        if close is None:
            dd.append(None)
            continue
        peak = close if peak is None else max(peak, close)
        dd.append((close / peak) - 1.0 if peak else 0.0)
    return dd


def max_drawdown_detail(closes, dates):
    """Returns max drawdown with peak/trough dates."""
    peak = None
    peak_idx = 0
    worst = 0.0
    worst_peak_idx = 0
    worst_trough_idx = 0
    for i, close in enumerate(closes):
        if close is None:
            continue
        if peak is None or close > peak:
            peak = close
            peak_idx = i
        dd = (close / peak) - 1.0 if peak else 0.0
        if dd < worst:
            worst = dd
            worst_peak_idx = peak_idx
            worst_trough_idx = i
    return {
        'max_drawdown': worst,
        'peak_date': dates[worst_peak_idx] if dates else None,
        'trough_date': dates[worst_trough_idx] if dates else None,
    }


def rolling_volatility(returns, window=20):
    """Rolling annualized volatility."""
    if len(returns) < window:
        return []
    result = []
    for i in range(window, len(returns) + 1):
        chunk = returns[i - window:i]
        vol = pstdev(chunk) * sqrt(252)
        result.append(vol)
    return result


def tail_risk_metrics(returns):
    """VaR and CVaR at 95% and 99% confidence."""
    if len(returns) < 20:
        return None
    sorted_r = sorted(returns)
    n = len(sorted_r)

    def percentile(pct):
        idx = int(n * pct)
        return sorted_r[max(0, min(idx, n - 1))]

    var_95 = percentile(0.05)
    var_99 = percentile(0.01)
    cvar_95 = mean(sorted_r[:max(1, int(n * 0.05))])
    cvar_99 = mean(sorted_r[:max(1, int(n * 0.01))])

    return {
        'var_95': var_95,
        'var_99': var_99,
        'cvar_95': cvar_95,
        'cvar_99': cvar_99,
        'worst_day': sorted_r[0],
        'best_day': sorted_r[-1],
        'skewness': compute_skewness(returns),
        'kurtosis_excess': compute_kurtosis_excess(returns),
    }


def compute_skewness(returns):
    if len(returns) < 3:
        return None
    mu = mean(returns)
    sigma = pstdev(returns)
    if sigma == 0:
        return None
    n = len(returns)
    return (n / ((n - 1) * (n - 2))) * sum(((r - mu) / sigma) ** 3 for r in returns) if n > 2 else None


def compute_kurtosis_excess(returns):
    if len(returns) < 4:
        return None
    mu = mean(returns)
    sigma = pstdev(returns)
    if sigma == 0:
        return None
    n = len(returns)
    kurt = mean(((r - mu) / sigma) ** 4 for r in returns)
    return kurt - 3.0


def detect_stress_periods(returns, dates, threshold=-0.02):
    """Detect consecutive days of negative returns (stress clusters)."""
    if not returns or not dates:
        return []
    stress = []
    current = None
    for i, r in enumerate(returns):
        date = dates[min(i + 1, len(dates) - 1)][:10] if dates else None
        if r < threshold:
            if current is None:
                current = {'start': date, 'end': date, 'cum_return': r, 'days': 1}
            else:
                current['end'] = date
                current['cum_return'] = (1 + current['cum_return']) * (1 + r) - 1
                current['days'] += 1
        else:
            if current and current['days'] >= 2:
                stress.append(current)
            current = None
    if current and current['days'] >= 2:
        stress.append(current)
    stress.sort(key=lambda x: x['cum_return'])
    return stress[:5]


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
benchmark = DATA.get('benchmark')

symbols = dedupe_symbols(DATA.get('symbols', []))
metrics = {'symbols': {}, 'benchmark': benchmark, 'comparisons': {}, 'correlation_matrix': None}

for symbol in symbols:
    hist = hist_data.get(symbol, [])
    rows = [row for row in hist if row.get('close') is not None]
    closes = [row['close'] for row in rows]
    dates = [row['date'][:10] for row in rows]
    returns = compute_returns(closes)

    total_return = None
    if len(closes) >= 2 and closes[0]:
        total_return = (closes[-1] / closes[0]) - 1.0

    realized_vol = pstdev(returns) * sqrt(252) if len(returns) >= 2 else None
    downside_returns = [r for r in returns if r < 0]
    downside_vol = pstdev(downside_returns) * sqrt(252) if len(downside_returns) >= 2 else None

    roll_vol = rolling_volatility(returns)

    metrics['symbols'][symbol] = {
        'quote': quotes.get(symbol),
        'history': {
            'bars': len(rows),
            'start': dates[0] if dates else None,
            'end': dates[-1] if dates else None,
            'last_close': closes[-1] if closes else None,
            'total_return': total_return,
            'realized_vol_annualized': realized_vol,
            'downside_vol_annualized': downside_vol,
            'sharpe_ratio': safe_div(total_return, realized_vol),
            'sortino_ratio': safe_div(total_return, downside_vol),
        },
        'drawdown': max_drawdown_detail(closes, dates),
        'tail_risk': tail_risk_metrics(returns),
        'rolling_vol': {
            'window': 20,
            'current': roll_vol[-1] if roll_vol else None,
            'min': min(roll_vol) if roll_vol else None,
            'max': max(roll_vol) if roll_vol else None,
            'mean': mean(roll_vol) if roll_vol else None,
        },
        'stress_periods': detect_stress_periods(returns, dates),
    }

# Benchmark comparisons
if benchmark and benchmark in hist_data:
    bench_rows = hist_data.get(benchmark, [])
    for symbol in symbols:
        if symbol == benchmark:
            continue
        sym_rows = hist_data.get(symbol, [])
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

# Correlation matrix
if len(symbols) > 1:
    matrix = {}
    for i, sym_a in enumerate(symbols):
        for sym_b in symbols[i+1:]:
            rows_a = hist_data.get(sym_a, [])
            rows_b = hist_data.get(sym_b, [])
            if not rows_a or not rows_b:
                continue
            pairs = paired_returns(rows_a, rows_b)
            xs = [p[0] for p in pairs]
            ys = [p[1] for p in pairs]
            matrix[f'{sym_a}_vs_{sym_b}'] = corr(xs, ys) if xs else None
    metrics['correlation_matrix'] = matrix

RESULT = metrics
