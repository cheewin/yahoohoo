import { extractJsonObject } from '../lib/json.js';

export function flattenSamplingContent(response) {
  if (!response) return '';
  const content = response.content;
  if (typeof content === 'string') return content;
  if (content?.type === 'text') return content.text || '';
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text') return item.text || '';
        return JSON.stringify(item);
      })
      .join('\n');
  }
  return JSON.stringify(content);
}

export async function requestJsonFromHost(ctx, {
  systemPrompt,
  userPrompt,
  maxTokens = 800,
  temperature = 0.2,
}) {
  if (!ctx?.mcpReq?.requestSampling) {
    throw new Error('The connected MCP client does not expose requestSampling().');
  }

  const response = await ctx.mcpReq.requestSampling({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `${systemPrompt.trim()}\n\n${userPrompt.trim()}`,
        },
      },
    ],
    maxTokens,
    temperature,
  });

  const rawText = flattenSamplingContent(response);
  const parsed = extractJsonObject(rawText);
  return {
    response,
    rawText,
    parsed,
  };
}

export async function trySampling(ctx, options) {
  try {
    return {
      ok: true,
      ...(await requestJsonFromHost(ctx, options)),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
