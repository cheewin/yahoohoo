"""Fundamentals-focused analysis for the Yahoohoo sandbox.

Expects DATA with: symbols, quotes, history, summaries.
Computes valuation comps, margin trends, capital allocation signals,
and basic balance-sheet stress indicators.

Sets RESULT to a dict with per-symbol fundamental metrics and cross-comparison.
"""

from math import sqrt
from statistics import pstdev, mean


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

    return {
        'bars': len(rows),
        'last_close': closes[-1] if closes else None,
        'total_return': total_return,
        'realized_vol_annualized': realized_vol,
    }


def extract_fundamentals(summary_payload):
    if not summary_payload:
        return None
    sd = summary_payload.get('summaryDetail') or {}
    fd = summary_payload.get('financialData') or {}
    ks = summary_payload.get('defaultKeyStatistics') or {}
    price = summary_payload.get('price') or {}
    ap = summary_payload.get('assetProfile') or {}
    ce = summary_payload.get('calendarEvents') or {}

    market_cap = sd.get('marketCap') or price.get('marketCap')
    trailing_pe = sd.get('trailingPE') or price.get('trailingPE')
    forward_pe = sd.get('forwardPE')
    peg = ks.get('pegRatio')
    pb = ks.get('priceToBook')
    ps = price.get('priceToSalesTrailing12Months') or ks.get('priceToSalesTrailing12Months')
    ev_ebitda = ks.get('enterpriseToEbitda')
    ev_revenue = ks.get('enterpriseToRevenue')

    profit_margins = fd.get('profitMargins')
    operating_margins = fd.get('operatingMargins')
    gross_margins = fd.get('grossMargins')
    ebitda_margins = fd.get('ebitdaMargins')
    roe = fd.get('returnOnEquity')
    roa = fd.get('returnOnAssets')
    revenue_growth = fd.get('revenueGrowth')
    earnings_growth = fd.get('earningsGrowth')

    total_debt = fd.get('totalDebt')
    total_cash = fd.get('totalCash')
    free_cash_flow = fd.get('freeCashflow')
    operating_cash_flow = fd.get('operatingCashflow')
    total_revenue = fd.get('totalRevenue')
    current_ratio = fd.get('currentRatio')
    debt_to_equity = fd.get('debtToEquity')

    dividend_yield = sd.get('dividendYield')
    payout_ratio = sd.get('payoutRatio')
    beta = ks.get('beta')

    sector = ap.get('sector')
    industry = ap.get('industry')
    employees = ap.get('fullTimeEmployees')

    earnings_dates = ce.get('earnings', {})

    # Derived
    fcf_yield = safe_div(free_cash_flow, market_cap) if market_cap else None
    net_debt = None
    if total_debt is not None and total_cash is not None:
        net_debt = total_debt - total_cash
    net_debt_to_ebitda = None
    ebitda = None
    if total_revenue is not None and ebitda_margins is not None:
        ebitda = total_revenue * ebitda_margins
        net_debt_to_ebitda = safe_div(net_debt, ebitda)
    revenue_per_employee = safe_div(total_revenue, employees)

    return {
        'valuation': {
            'market_cap': market_cap,
            'trailing_pe': trailing_pe,
            'forward_pe': forward_pe,
            'peg_ratio': peg,
            'price_to_book': pb,
            'price_to_sales': ps,
            'ev_to_ebitda': ev_ebitda,
            'ev_to_revenue': ev_revenue,
            'fcf_yield': fcf_yield,
        },
        'profitability': {
            'gross_margins': gross_margins,
            'operating_margins': operating_margins,
            'profit_margins': profit_margins,
            'ebitda_margins': ebitda_margins,
            'return_on_equity': roe,
            'return_on_assets': roa,
        },
        'growth': {
            'revenue_growth': revenue_growth,
            'earnings_growth': earnings_growth,
        },
        'balance_sheet': {
            'total_debt': total_debt,
            'total_cash': total_cash,
            'net_debt': net_debt,
            'current_ratio': current_ratio,
            'debt_to_equity': debt_to_equity,
            'net_debt_to_ebitda': net_debt_to_ebitda,
        },
        'capital_allocation': {
            'free_cash_flow': free_cash_flow,
            'operating_cash_flow': operating_cash_flow,
            'dividend_yield': dividend_yield,
            'payout_ratio': payout_ratio,
        },
        'profile': {
            'sector': sector,
            'industry': industry,
            'employees': employees,
            'revenue_per_employee': revenue_per_employee,
            'beta': beta,
        },
        'events': {
            'earnings': earnings_dates,
        },
    }


def build_valuation_comps(symbols, metrics):
    """Build a comparison table of valuation metrics across symbols."""
    fields = ['trailing_pe', 'forward_pe', 'peg_ratio', 'price_to_book',
              'price_to_sales', 'ev_to_ebitda', 'ev_to_revenue', 'fcf_yield']
    comps = {}
    for field in fields:
        values = {}
        for symbol in symbols:
            fund = metrics.get('symbols', {}).get(symbol, {}).get('fundamentals')
            if fund:
                val = fund.get('valuation', {}).get(field)
                if val is not None:
                    values[symbol] = val
        if values:
            sorted_by_val = sorted(values.items(), key=lambda x: x[1])
            comps[field] = {
                'values': values,
                'cheapest': sorted_by_val[0][0] if sorted_by_val else None,
                'richest': sorted_by_val[-1][0] if sorted_by_val else None,
                'median': sorted([v for v in values.values()])[len(values)//2] if values else None,
            }
    return comps


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
summaries = DATA.get('summaries', {})

symbols = dedupe_symbols(DATA.get('symbols', []))
metrics = {'symbols': {}, 'benchmark': DATA.get('benchmark'), 'valuation_comps': None}

for symbol in symbols:
    hist = hist_data.get(symbol, [])
    metrics['symbols'][symbol] = {
        'quote': quotes.get(symbol),
        'history': summarize_history(hist) if hist else {'bars': 0},
        'fundamentals': extract_fundamentals(summaries.get(symbol)),
    }

if len(symbols) > 1:
    metrics['valuation_comps'] = build_valuation_comps(symbols, metrics)

RESULT = metrics
