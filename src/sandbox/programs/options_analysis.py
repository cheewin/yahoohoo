"""Options-focused analysis for the Yahoohoo sandbox.

Expects DATA with: symbols, benchmark, quotes, history, options.
When multi-expiry chains are available (options.SYMBOL.chains array),
computes per-expiry metrics, 0DTE detection, and aggregate dealer-position
proxy across expiries.

Single-expiry mode remains backward compatible.

Sign convention (standard SpotGamma/SqueezeMetrics):
  calls  -> positive GEX (dealer short calls, stabilizing above strike)
  puts   -> negative GEX (dealer short puts, amplifying below strike)

All dealer-position outputs are proxies based on open interest and
Black-Scholes gamma. They do not represent exact dealer inventory.

Sets RESULT to a dict with per-symbol options metrics and history context.
"""

from math import sqrt, log, exp, pi
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


def extract_date_parts(value):
    if value is None:
        return None
    text = str(value)
    try:
        return (int(text[:4]), int(text[5:7]), int(text[8:10]))
    except Exception:
        return None


def format_date_parts(parts):
    if parts is None:
        return None
    year, month, day = parts
    return f'{year:04d}-{month:02d}-{day:02d}'


def ordinal_day(parts):
    year, month, day = parts
    year -= 1 if month <= 2 else 0
    era = year // 400 if year >= 0 else (year - 399) // 400
    year_of_era = year - era * 400
    month_prime = month + 9 if month <= 2 else month - 3
    day_of_year = (153 * month_prime + 2) // 5 + day - 1
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
    return era * 146097 + day_of_era


def contract_multiplier(contract):
    size = contract.get('contractSize')
    if size == 'REGULAR':
        return 100.0
    try:
        return float(size)
    except Exception:
        return 100.0


def normal_pdf(x):
    return exp(-0.5 * x * x) / sqrt(2.0 * pi)


def estimate_gamma(spot, strike, iv, time_years):
    if spot in (None, 0) or strike in (None, 0) or iv in (None, 0) or time_years in (None, 0):
        return None
    if spot <= 0 or strike <= 0 or iv <= 0 or time_years <= 0:
        return None
    sigma_sqrt_t = iv * sqrt(time_years)
    if sigma_sqrt_t == 0:
        return None
    d1 = (log(spot / strike) + 0.5 * iv * iv * time_years) / sigma_sqrt_t
    return normal_pdf(d1) / (spot * sigma_sqrt_t)


def select_active_expiration(options_payload, contracts, reference_parts):
    candidates = []
    for contract in contracts:
        expiration = extract_date_parts(contract.get('expiration'))
        if expiration is not None:
            candidates.append(expiration)
    if not candidates:
        for raw in options_payload.get('expirationDates') or []:
            expiration = extract_date_parts(raw)
            if expiration is not None:
                candidates.append(expiration)
    if not candidates:
        return None
    reference_ordinal = ordinal_day(reference_parts) if reference_parts else None
    future = [expiration for expiration in candidates if reference_ordinal is None or ordinal_day(expiration) >= reference_ordinal]
    pool = future if future else candidates
    return min(pool, key=ordinal_day)


def time_to_expiry_years(expiration_parts, reference_parts):
    if expiration_parts is None or reference_parts is None:
        return None
    delta_days = ordinal_day(expiration_parts) - ordinal_day(reference_parts)
    # With date-only inputs, keep same-day expiries stable using a quarter-day floor.
    clamped_days = max(float(delta_days), 0.25)
    return clamped_days / 365.25


def aggregate_by_strike(contracts, field):
    grouped = {}
    for contract in contracts:
        strike = contract.get('strike')
        value = contract.get(field) or 0
        if strike is None:
            continue
        grouped[strike] = grouped.get(strike, 0) + value
    return grouped


def top_entries(grouped, count=5, *, by_abs=False):
    items = grouped.items()
    if by_abs:
        ranked = sorted(items, key=lambda item: (-abs(item[1]), item[0]))
    else:
        ranked = sorted(items, key=lambda item: (-item[1], item[0]))
    return [{'strike': strike, 'value': value} for strike, value in ranked[:count]]


def max_pain_metrics(calls, puts, candidate_strikes):
    if not candidate_strikes:
        return None

    payouts = []
    for settlement in candidate_strikes:
        total = 0.0
        for contract in calls:
            strike = contract.get('strike')
            oi = contract.get('openInterest') or 0
            if strike is None or oi <= 0:
                continue
            total += max(0.0, settlement - strike) * oi * contract_multiplier(contract)
        for contract in puts:
            strike = contract.get('strike')
            oi = contract.get('openInterest') or 0
            if strike is None or oi <= 0:
                continue
            total += max(0.0, strike - settlement) * oi * contract_multiplier(contract)
        payouts.append({'strike': settlement, 'total_payout': total})

    payouts.sort(key=lambda row: (row['total_payout'], row['strike']))
    best = payouts[0] if payouts else None
    return {
        'strike': best.get('strike') if best else None,
        'total_payout': best.get('total_payout') if best else None,
        'top_levels': payouts[:5],
    }


def gex_metrics(calls, puts, last_close, reference_parts, active_expiration):
    if last_close in (None, 0):
        return None

    contracts = []
    for option_type, rows in (('call', calls), ('put', puts)):
        for contract in rows:
            oi = contract.get('openInterest') or 0
            strike = contract.get('strike')
            iv = contract.get('impliedVolatility')
            if oi <= 0 or strike in (None, 0) or iv in (None, 0):
                continue
            contracts.append((option_type, contract))

    if not contracts:
        return None

    def net_gex_at_spot(spot):
        call_total = 0.0
        put_total = 0.0
        by_strike = {}
        for option_type, contract in contracts:
            expiration_parts = extract_date_parts(contract.get('expiration')) or active_expiration
            time_years = time_to_expiry_years(expiration_parts, reference_parts)
            gamma = estimate_gamma(spot, contract.get('strike'), contract.get('impliedVolatility'), time_years)
            if gamma is None:
                continue
            exposure = gamma * (contract.get('openInterest') or 0) * contract_multiplier(contract) * (spot ** 2) * 0.01
            signed = exposure if option_type == 'call' else -exposure
            strike = contract.get('strike')
            by_strike[strike] = by_strike.get(strike, 0.0) + signed
            if option_type == 'call':
                call_total += exposure
            else:
                put_total += signed
        return {
            'call_total': call_total,
            'put_total': put_total,
            'net_total': call_total + put_total,
            'by_strike': by_strike,
        }

    base = net_gex_at_spot(last_close)
    if not base['by_strike']:
        return None

    positive = [(strike, value) for strike, value in base['by_strike'].items() if value > 0]
    negative = [(strike, value) for strike, value in base['by_strike'].items() if value < 0]

    strikes = sorted(base['by_strike'])
    grid = []
    if strikes:
        grid.append(max(0.01, strikes[0] * 0.85))
        for idx, strike in enumerate(strikes):
            grid.append(strike)
            if idx + 1 < len(strikes):
                grid.append((strike + strikes[idx + 1]) / 2.0)
        grid.append(strikes[-1] * 1.15)

    curve = []
    for spot in sorted(set(grid)):
        exposure = net_gex_at_spot(spot)
        curve.append((spot, exposure['net_total']))

    flips = []
    for left, right in zip(curve, curve[1:]):
        x0, y0 = left
        x1, y1 = right
        if y0 == 0:
            flips.append(x0)
            continue
        if y1 == 0:
            flips.append(x1)
            continue
        if y0 * y1 < 0:
            flips.append(x0 - y0 * (x1 - x0) / (y1 - y0))

    gamma_flip = None
    if flips:
        gamma_flip = min(flips, key=lambda value: abs(value - last_close))

    return {
        'call_gex_1pct_move': base['call_total'],
        'put_gex_1pct_move': base['put_total'],
        'net_gex_1pct_move': base['net_total'],
        'largest_positive_gex_strike': (
            {'strike': max(positive, key=lambda item: item[1])[0], 'gex_1pct_move': max(positive, key=lambda item: item[1])[1]}
            if positive else None
        ),
        'largest_negative_gex_strike': (
            {'strike': min(negative, key=lambda item: item[1])[0], 'gex_1pct_move': min(negative, key=lambda item: item[1])[1]}
            if negative else None
        ),
        'top_abs_gex_strikes': top_entries(base['by_strike'], by_abs=True),
        'gamma_flip': gamma_flip,
        'estimated_contracts': len(contracts),
        'by_strike': base['by_strike'],
    }


# ─── Per-chain metrics (used for expiry sweep and 0DTE) ─────────────

def compute_chain_metrics(calls, puts, last_close, reference_parts, expiration_parts):
    """Compute standard options metrics for a single expiry chain."""
    if not calls and not puts:
        return None

    # IV stats
    all_ivs = []
    for c in calls:
        iv = c.get('impliedVolatility')
        if iv is not None:
            all_ivs.append(iv)
    for p in puts:
        iv = p.get('impliedVolatility')
        if iv is not None:
            all_ivs.append(iv)

    # ATM IV
    atm_ivs = []
    if last_close:
        for contract in calls + puts:
            strike = contract.get('strike')
            iv = contract.get('impliedVolatility')
            if strike and iv and abs(strike - last_close) / last_close < 0.02:
                atm_ivs.append(iv)

    # OI
    call_oi = sum((c.get('openInterest') or 0) for c in calls)
    put_oi = sum((p.get('openInterest') or 0) for p in puts)
    total_oi = call_oi + put_oi

    # Walls
    call_oi_by_strike = aggregate_by_strike(calls, 'openInterest')
    put_oi_by_strike = aggregate_by_strike(puts, 'openInterest')

    call_wall = None
    if call_oi_by_strike:
        best = max(call_oi_by_strike.items(), key=lambda item: item[1])
        call_wall = {'strike': best[0], 'oi': best[1]}

    put_wall = None
    if put_oi_by_strike:
        best = max(put_oi_by_strike.items(), key=lambda item: item[1])
        put_wall = {'strike': best[0], 'oi': best[1]}

    # Max pain
    candidate_strikes = sorted(set(list(call_oi_by_strike.keys()) + list(put_oi_by_strike.keys())))
    max_pain = max_pain_metrics(calls, puts, candidate_strikes)
    if max_pain and last_close:
        max_pain['distance_from_spot_pct'] = (max_pain['strike'] / last_close) - 1.0 if max_pain.get('strike') else None

    # GEX
    gex = gex_metrics(calls, puts, last_close, reference_parts, expiration_parts)
    gamma_flip = None
    if gex and gex.get('gamma_flip') is not None:
        gamma_flip = {
            'level': gex['gamma_flip'],
            'distance_from_spot_pct': ((gex['gamma_flip'] / last_close) - 1.0) if last_close else None,
        }

    # DTE
    dte_days = None
    if expiration_parts and reference_parts:
        dte_days = ordinal_day(expiration_parts) - ordinal_day(reference_parts)
        if dte_days < 0:
            dte_days = None

    return {
        'expiry': format_date_parts(expiration_parts),
        'dte_days': dte_days,
        'sampled_calls': len(calls),
        'sampled_puts': len(puts),
        'total_open_interest': total_oi,
        'put_call_oi_ratio': (put_oi / call_oi) if call_oi > 0 else None,
        'avg_iv': mean(all_ivs) if all_ivs else None,
        'atm_iv': mean(atm_ivs) if atm_ivs else None,
        'call_wall': call_wall,
        'put_wall': put_wall,
        'max_pain': max_pain,
        'call_gex_1pct_move': gex.get('call_gex_1pct_move') if gex else None,
        'put_gex_1pct_move': gex.get('put_gex_1pct_move') if gex else None,
        'net_gex_1pct_move': gex.get('net_gex_1pct_move') if gex else None,
        'gamma_flip': gamma_flip,
        'top_abs_gex_strikes': gex.get('top_abs_gex_strikes') if gex else [],
        'estimated_gex_contracts': gex.get('estimated_contracts') if gex else 0,
    }


# ─── Dealer profile (aggregate across swept expiries) ───────────────

def build_dealer_profile(sweep, all_calls, all_puts, last_close, reference_parts):
    """Build aggregate proxy dealer-position profile across swept expiries.

    Uses combined contracts from all swept chains for aggregate GEX.
    All outputs are proxies based on OI-weighted BS gamma.
    """
    if not sweep:
        return None

    # Use earliest expiry as fallback for contracts missing expiration field
    fallback_exp = None
    for entry in sweep:
        parts = extract_date_parts(entry.get('expiry'))
        if parts is not None:
            fallback_exp = parts
            break

    # Aggregate GEX across all contracts from all chains
    agg_gex = gex_metrics(all_calls, all_puts, last_close, reference_parts, fallback_exp)

    agg_gamma_flip = None
    if agg_gex and agg_gex.get('gamma_flip') is not None:
        agg_gamma_flip = {
            'level': agg_gex['gamma_flip'],
            'distance_from_spot_pct': ((agg_gex['gamma_flip'] / last_close) - 1.0) if last_close else None,
        }

    # Top positive/negative GEX strikes across all expiries
    top_pos = []
    top_neg = []
    if agg_gex:
        for entry in agg_gex.get('top_abs_gex_strikes') or []:
            if entry['value'] > 0:
                top_pos.append(entry)
            elif entry['value'] < 0:
                top_neg.append(entry)
    # Augment from per-expiry data if aggregate didn't yield enough
    strike_gex_pos = {}
    strike_gex_neg = {}
    for entry in sweep:
        for gs in entry.get('top_abs_gex_strikes') or []:
            strike = gs['strike']
            val = gs['value']
            if val > 0:
                strike_gex_pos[strike] = strike_gex_pos.get(strike, 0.0) + val
            elif val < 0:
                strike_gex_neg[strike] = strike_gex_neg.get(strike, 0.0) + val
    if not top_pos and strike_gex_pos:
        top_pos = top_entries(strike_gex_pos, count=5)
    if not top_neg and strike_gex_neg:
        top_neg = top_entries({k: -v for k, v in strike_gex_neg.items()}, count=5)
        top_neg = [{'strike': e['strike'], 'value': -e['value']} for e in top_neg]

    # Max-pain ladder
    max_pain_ladder = []
    for entry in sweep:
        mp = entry.get('max_pain')
        if mp and mp.get('strike') is not None:
            max_pain_ladder.append({
                'expiry': entry.get('expiry'),
                'dte_days': entry.get('dte_days'),
                'max_pain_strike': mp['strike'],
                'distance_from_spot_pct': mp.get('distance_from_spot_pct'),
            })

    # Per-expiry GEX breakdown
    by_expiry = []
    largest_pos_gex_expiry = None
    largest_neg_gex_expiry = None
    best_pos = 0.0
    worst_neg = 0.0
    for entry in sweep:
        net = entry.get('net_gex_1pct_move')
        call_g = entry.get('call_gex_1pct_move')
        put_g = entry.get('put_gex_1pct_move')
        by_expiry.append({
            'expiry': entry.get('expiry'),
            'dte_days': entry.get('dte_days'),
            'call_gex': call_g,
            'put_gex': put_g,
            'net_gex': net,
        })
        if net is not None:
            if net > best_pos:
                best_pos = net
                largest_pos_gex_expiry = entry.get('expiry')
            if net < worst_neg:
                worst_neg = net
                largest_neg_gex_expiry = entry.get('expiry')

    return {
        'label': 'proxy dealer-position profile (OI-based BS gamma, not exact inventory)',
        'expiries_included': len(sweep),
        'aggregate_call_gex': agg_gex.get('call_gex_1pct_move') if agg_gex else None,
        'aggregate_put_gex': agg_gex.get('put_gex_1pct_move') if agg_gex else None,
        'aggregate_net_gex': agg_gex.get('net_gex_1pct_move') if agg_gex else None,
        'aggregate_gamma_flip': agg_gamma_flip,
        'top_positive_gex_strikes': top_pos[:5],
        'top_negative_gex_strikes': top_neg[:5],
        'largest_positive_gex_expiry': largest_pos_gex_expiry,
        'largest_negative_gex_expiry': largest_neg_gex_expiry,
        'max_pain_ladder': max_pain_ladder,
        'by_expiry': by_expiry,
        '_gex_by_strike': agg_gex.get('by_strike') if agg_gex else None,
    }


# ─── Main analyze_options ───────────────────────────────────────────

def analyze_options(options_payload, last_close, reference_parts):
    if not options_payload:
        return None

    calls = options_payload.get('calls') or []
    puts = options_payload.get('puts') or []
    all_contracts = calls + puts
    active_expiration = select_active_expiration(options_payload, all_contracts, reference_parts)

    # ── Basic IV stats (from active/primary chain) ──
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
    strike_oi = aggregate_by_strike(all_contracts, 'openInterest')
    top_strikes = sorted(strike_oi.items(), key=lambda x: -x[1])[:5]
    call_oi_by_strike = aggregate_by_strike(calls, 'openInterest')
    put_oi_by_strike = aggregate_by_strike(puts, 'openInterest')
    candidate_strikes = sorted(set(list(call_oi_by_strike.keys()) + list(put_oi_by_strike.keys())))

    max_pain = max_pain_metrics(calls, puts, candidate_strikes)
    if max_pain and last_close:
        max_pain['distance_from_spot_pct'] = (max_pain['strike'] / last_close) - 1.0 if max_pain.get('strike') else None

    gex = gex_metrics(calls, puts, last_close, reference_parts, active_expiration)
    gamma_flip = None
    if gex and gex.get('gamma_flip') is not None:
        gamma_flip = {
            'level': gex['gamma_flip'],
            'distance_from_spot_pct': ((gex['gamma_flip'] / last_close) - 1.0) if last_close else None,
        }

    result = {
        'sampled_calls': len(calls),
        'sampled_puts': len(puts),
        'active_expiration': format_date_parts(active_expiration),
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
        'call_wall': (
            {'strike': max(call_oi_by_strike.items(), key=lambda item: item[1])[0], 'oi': max(call_oi_by_strike.items(), key=lambda item: item[1])[1]}
            if call_oi_by_strike else None
        ),
        'put_wall': (
            {'strike': max(put_oi_by_strike.items(), key=lambda item: item[1])[0], 'oi': max(put_oi_by_strike.items(), key=lambda item: item[1])[1]}
            if put_oi_by_strike else None
        ),
        'max_pain': max_pain,
        'call_gex_1pct_move': gex.get('call_gex_1pct_move') if gex else None,
        'put_gex_1pct_move': gex.get('put_gex_1pct_move') if gex else None,
        'net_gex_1pct_move': gex.get('net_gex_1pct_move') if gex else None,
        'largest_positive_gex_strike': gex.get('largest_positive_gex_strike') if gex else None,
        'largest_negative_gex_strike': gex.get('largest_negative_gex_strike') if gex else None,
        'top_abs_gex_strikes': gex.get('top_abs_gex_strikes') if gex else [],
        'gamma_flip': gamma_flip,
        'estimated_gex_contracts': gex.get('estimated_contracts') if gex else 0,
        'expirations': options_payload.get('expirationDates') or [],
        '_gex_by_strike': gex.get('by_strike') if gex else None,
    }

    # ── Multi-expiry sweep ──
    chains = options_payload.get('chains')
    if chains and len(chains) > 0:
        sweep = []
        all_sweep_calls = []
        all_sweep_puts = []
        for chain in chains:
            chain_calls = chain.get('calls') or []
            chain_puts = chain.get('puts') or []
            exp_parts = extract_date_parts(chain.get('expirationDate'))
            if not chain_calls and not chain_puts:
                continue
            metrics = compute_chain_metrics(chain_calls, chain_puts, last_close, reference_parts, exp_parts)
            if metrics is not None:
                sweep.append(metrics)
                all_sweep_calls.extend(chain_calls)
                all_sweep_puts.extend(chain_puts)

        # Sort sweep by DTE (nearest first), nulls last
        sweep.sort(key=lambda e: e['dte_days'] if e.get('dte_days') is not None else 999999)

        # 0DTE detection
        zero_dte = None
        if reference_parts:
            ref_ord = ordinal_day(reference_parts)
            for entry in sweep:
                exp_parts = extract_date_parts(entry.get('expiry'))
                if exp_parts is not None and ordinal_day(exp_parts) == ref_ord:
                    zero_dte = entry
                    break

        # Dealer profile
        dealer_profile = build_dealer_profile(sweep, all_sweep_calls, all_sweep_puts, last_close, reference_parts)

        result['zero_dte'] = zero_dte
        result['expiry_sweep'] = sweep
        result['dealer_profile'] = dealer_profile
    else:
        result['zero_dte'] = None
        result['expiry_sweep'] = None
        result['dealer_profile'] = None

    return result


def dedupe_symbols(values):
    symbols = []
    seen = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        symbols.append(value)
    return symbols


# ─── Dashboard rendering ─────────────────────────────────────────────

def _fmt_gex(v):
    if v is None:
        return '—'
    a = abs(v)
    if a >= 1e9:
        return f'{v/1e9:+.1f}B'
    if a >= 1e6:
        return f'{v/1e6:+.1f}M'
    if a >= 1e3:
        return f'{v/1e3:+.1f}K'
    return f'{v:+.0f}'


def _fmt_num(v):
    if v is None:
        return '—'
    return f'{v:,.2f}'


def _fmt_pct(v):
    if v is None:
        return '—'
    return f'{v * 100:.1f}%'


def _fmt_oi(v):
    if v is None:
        return '—'
    if v >= 1e6:
        return f'{v / 1e6:.1f}M'
    if v >= 1e3:
        return f'{v / 1e3:.1f}K'
    return str(int(v))


def render_gex_chart(by_strike, spot, gamma_flip, max_rows=20, bar_half=20):
    """Render horizontal GEX profile chart. Each row is a strike,
    bars extend left (puts/negative) or right (calls/positive)."""
    if not by_strike or not spot:
        return None

    lo, hi = spot * 0.92, spot * 1.08
    filtered = {s: v for s, v in by_strike.items() if lo <= s <= hi}
    if len(filtered) < 4:
        filtered = by_strike

    items = sorted(filtered.items())
    if len(items) > max_rows:
        s_min, s_max = items[0][0], items[-1][0]
        bw = (s_max - s_min) / max_rows
        if bw > 0:
            buckets = {}
            for s, v in items:
                bi = min(int((s - s_min) / bw), max_rows - 1)
                center = round(s_min + (bi + 0.5) * bw, 1)
                buckets[center] = buckets.get(center, 0) + v
            items = sorted(buckets.items())

    if not items:
        return None

    max_abs = max(abs(v) for _, v in items)
    if max_abs == 0:
        return None

    step = items[1][0] - items[0][0] if len(items) > 1 else 1

    lines = []
    lines.append('── GEX Profile ─────────────────────────────────────────')
    lines.append(f'   spot: {spot:.2f}')
    if gamma_flip is not None:
        diff_pct = ((gamma_flip / spot) - 1) * 100
        lines.append(f'   γ-flip: {gamma_flip:.2f} ({diff_pct:+.2f}% vs spot)')
    lines.append('')

    for strike, value in items:
        scaled = round(abs(value) / max_abs * bar_half)
        if value >= 0:
            neg = ' ' * bar_half
            pos = '█' * scaled + ' ' * (bar_half - scaled)
        else:
            neg = ' ' * (bar_half - scaled) + '▓' * scaled
            pos = ' ' * bar_half

        label = _fmt_gex(value)
        annot = ''
        if abs(strike - spot) <= step * 0.55:
            annot = ' ◄ spot'
        if gamma_flip is not None and abs(strike - gamma_flip) <= step * 0.55:
            annot += ', γ-flip' if annot else ' ◄ γ-flip'

        lines.append(f'  {strike:>7.0f} {neg}│{pos} {label:>7}{annot}')

    lines.append(f'  {"":>7} {"◁ puts":>{bar_half}} {"calls ▷":<{bar_half}}')
    return '\n'.join(lines)


def render_key_levels(spot, opts):
    if not opts:
        return None

    lines = []
    lines.append('── Key Levels ──────────────────────────────────────────')

    def row(label, val, extra=''):
        lines.append(f'  {label:<18} {val}{extra}')

    row('Spot Price', _fmt_num(spot))

    mp = opts.get('max_pain')
    if mp and mp.get('strike') is not None:
        pct = f'  ({_fmt_pct(mp.get("distance_from_spot_pct"))} vs spot)' if mp.get('distance_from_spot_pct') is not None else ''
        row('Max Pain', _fmt_num(mp['strike']), pct)

    cw = opts.get('call_wall')
    if cw and cw.get('strike') is not None:
        row('Call Wall', _fmt_num(cw['strike']), f'  OI: {_fmt_oi(cw.get("oi"))}')

    pw = opts.get('put_wall')
    if pw and pw.get('strike') is not None:
        row('Put Wall', _fmt_num(pw['strike']), f'  OI: {_fmt_oi(pw.get("oi"))}')

    gf = opts.get('gamma_flip')
    if gf and gf.get('level') is not None:
        pct = f'  ({_fmt_pct(gf.get("distance_from_spot_pct"))} vs spot)' if gf.get('distance_from_spot_pct') is not None else ''
        row('Gamma Flip', _fmt_num(gf['level']), pct)

    if opts.get('atm_iv') is not None:
        row('ATM IV', _fmt_pct(opts['atm_iv']))
    if opts.get('put_call_oi_ratio') is not None:
        row('P/C OI Ratio', _fmt_num(opts['put_call_oi_ratio']))
    if opts.get('net_gex_1pct_move') is not None:
        row('Net GEX (1%)', _fmt_gex(opts['net_gex_1pct_move']))
    if opts.get('total_open_interest') is not None:
        row('Total OI', _fmt_oi(opts['total_open_interest']))

    return '\n'.join(lines)


def render_sweep_table(sweep):
    if not sweep or len(sweep) < 2:
        return None

    lines = []
    lines.append(f'── Expiry Sweep ({len(sweep)} expiries) ─────────────────────────')
    lines.append(f'  {"Expiry":<12} {"DTE":>4}  {"OI":>8}  {"MaxPain":>8}  {"NetGEX":>8}  {"ATM IV":>6}')
    lines.append(f'  {"─" * 12} {"─" * 4}  {"─" * 8}  {"─" * 8}  {"─" * 8}  {"─" * 6}')

    for e in sweep:
        expiry = (e.get('expiry') or '—')[:10]
        dte = str(e.get('dte_days')) if e.get('dte_days') is not None else '—'
        oi = _fmt_oi(e.get('total_open_interest'))
        mp_s = e.get('max_pain', {}).get('strike') if e.get('max_pain') else None
        mp_str = _fmt_num(mp_s) if mp_s is not None else '—'
        net = _fmt_gex(e.get('net_gex_1pct_move'))
        atm = _fmt_pct(e.get('atm_iv'))
        lines.append(f'  {expiry:<12} {dte:>4}  {oi:>8}  {mp_str:>8}  {net:>8}  {atm:>6}')

    return '\n'.join(lines)


def render_iv_term_structure(sweep):
    if not sweep or len(sweep) < 2:
        return None

    entries = [(e.get('dte_days'), e.get('atm_iv'))
               for e in sweep
               if e.get('dte_days') is not None and e.get('atm_iv') is not None]
    if len(entries) < 2:
        return None

    entries.sort()
    max_iv = max(iv for _, iv in entries)
    min_iv = min(iv for _, iv in entries)
    if max_iv == min_iv:
        return None

    chart_w = 25
    lines = []
    lines.append('── IV Term Structure ───────────────────────────────────')

    for dte, iv in entries:
        scaled = round((iv - min_iv) / (max_iv - min_iv) * chart_w)
        bar = '░' * scaled + '█'
        lines.append(f'  {dte:>3}d  {_fmt_pct(iv):>6}  {bar}')

    return '\n'.join(lines)


def render_dealer_summary(dp, spot):
    if not dp:
        return None

    lines = []
    lines.append('── Dealer Profile (proxy) ──────────────────────────────')

    def row(label, val):
        lines.append(f'  {label:<22} {val}')

    row('Expiries Included', str(dp.get('expiries_included', 0)))

    net = dp.get('aggregate_net_gex')
    if net is not None:
        regime = 'Positive γ (stabilizing)' if net > 0 else 'Negative γ (amplifying)'
        row('Aggregate Net GEX', _fmt_gex(net))
        row('Regime', regime)

    if dp.get('aggregate_call_gex') is not None:
        row('Call GEX', _fmt_gex(dp['aggregate_call_gex']))
    if dp.get('aggregate_put_gex') is not None:
        row('Put GEX', _fmt_gex(dp['aggregate_put_gex']))

    gf = dp.get('aggregate_gamma_flip')
    if gf and gf.get('level') is not None:
        pct = f' ({_fmt_pct(gf.get("distance_from_spot_pct"))} vs spot)' if gf.get('distance_from_spot_pct') is not None else ''
        row('Gamma Flip (agg)', f'{_fmt_num(gf["level"])}{pct}')

    top_pos = dp.get('top_positive_gex_strikes') or []
    if top_pos:
        s = ', '.join(f'{e["strike"]:.0f}({_fmt_gex(e["value"])})' for e in top_pos[:3])
        row('Top +GEX Strikes', s)

    top_neg = dp.get('top_negative_gex_strikes') or []
    if top_neg:
        s = ', '.join(f'{e["strike"]:.0f}({_fmt_gex(e["value"])})' for e in top_neg[:3])
        row('Top -GEX Strikes', s)

    ladder = dp.get('max_pain_ladder') or []
    if ladder:
        lines.append('')
        lines.append('  Max Pain Ladder:')
        for mp in ladder:
            exp = (mp.get('expiry') or '—')[:10]
            dte = mp.get('dte_days')
            strike = _fmt_num(mp.get('max_pain_strike'))
            pct = f' ({_fmt_pct(mp.get("distance_from_spot_pct"))})' if mp.get('distance_from_spot_pct') is not None else ''
            lines.append(f'    {exp} ({dte}d): {strike}{pct}')

    return '\n'.join(lines)


def render_zero_dte(zd):
    if not zd:
        return None

    lines = []
    lines.append('── 0DTE ────────────────────────────────────────────────')
    lines.append(f'  Expiry: {zd.get("expiry", "—")}')
    lines.append(f'  Contracts: {zd.get("sampled_calls", 0)} calls, {zd.get("sampled_puts", 0)} puts')
    if zd.get('total_open_interest') is not None:
        lines.append(f'  Total OI: {_fmt_oi(zd["total_open_interest"])}')
    if zd.get('net_gex_1pct_move') is not None:
        lines.append(f'  Net GEX: {_fmt_gex(zd["net_gex_1pct_move"])}')
    if zd.get('max_pain') and zd['max_pain'].get('strike') is not None:
        lines.append(f'  Max Pain: {_fmt_num(zd["max_pain"]["strike"])}')
    if zd.get('atm_iv') is not None:
        lines.append(f'  ATM IV: {_fmt_pct(zd["atm_iv"])}')
    return '\n'.join(lines)


def build_dashboard(symbol, opts, last_close):
    """Build combined options dashboard."""
    if not opts:
        return None

    sep = '═' * 56
    sections = []
    sections.append(sep)
    sections.append(f'  {symbol} OPTIONS DASHBOARD')
    sections.append(sep)
    sections.append('')

    kl = render_key_levels(last_close, opts)
    if kl:
        sections.append(kl)
        sections.append('')

    by_strike = opts.get('_gex_by_strike')
    gf_data = opts.get('gamma_flip') or {}
    gf_level = gf_data.get('level')

    dp = opts.get('dealer_profile')
    if dp and dp.get('_gex_by_strike'):
        by_strike = dp['_gex_by_strike']
        agg_gf = dp.get('aggregate_gamma_flip') or {}
        if agg_gf.get('level') is not None:
            gf_level = agg_gf['level']

    chart = render_gex_chart(by_strike, last_close, gf_level)
    if chart:
        sections.append(chart)
        sections.append('')

    sweep = opts.get('expiry_sweep')

    iv_ts = render_iv_term_structure(sweep)
    if iv_ts:
        sections.append(iv_ts)
        sections.append('')

    st = render_sweep_table(sweep)
    if st:
        sections.append(st)
        sections.append('')

    zd = render_zero_dte(opts.get('zero_dte'))
    if zd:
        sections.append(zd)
        sections.append('')

    ds = render_dealer_summary(dp, last_close)
    if ds:
        sections.append(ds)
        sections.append('')

    sections.append(sep)
    sections.append('  Proxy data · OI-based BS gamma · Not exact dealer inventory')
    sections.append(sep)
    return '\n'.join(sections)


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
    reference_parts = extract_date_parts(hist[-1].get('date')) if hist else None

    opts = analyze_options(options_data.get(symbol), last_close, reference_parts)

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

    if opts:
        dashboard = build_dashboard(symbol, opts, last_close)
        if dashboard:
            opts['_dashboard'] = dashboard

    metrics['symbols'][symbol] = {
        'quote': quotes.get(symbol),
        'history': h,
        'options': opts,
        'iv_vs_realized': iv_vs_rv,
    }

RESULT = metrics
