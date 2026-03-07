export function stableStringify(value, space = 2) {
  return JSON.stringify(value, replacer, space);
}

function replacer(_key, value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = value[key];
        return acc;
      }, {});
  }
  return value;
}

export function extractJsonObject(text) {
  if (!text) throw new Error('No text returned from sampling response.');

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  }

  throw new Error('Could not extract JSON object from text.');
}
