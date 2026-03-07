import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { flattenSamplingContent, trySampling } from '../../src/core/sampling.js';

describe('flattenSamplingContent', () => {
  it('returns empty string for null response', () => {
    assert.equal(flattenSamplingContent(null), '');
  });

  it('handles string content', () => {
    assert.equal(flattenSamplingContent({ content: 'hello' }), 'hello');
  });

  it('handles text-type content', () => {
    assert.equal(flattenSamplingContent({ content: { type: 'text', text: 'hello' } }), 'hello');
  });

  it('handles array content', () => {
    const result = flattenSamplingContent({
      content: [
        { type: 'text', text: 'line1' },
        { type: 'text', text: 'line2' },
      ],
    });
    assert.ok(result.includes('line1'));
    assert.ok(result.includes('line2'));
  });

  it('handles mixed array content', () => {
    const result = flattenSamplingContent({
      content: ['hello', { type: 'text', text: 'world' }],
    });
    assert.ok(result.includes('hello'));
    assert.ok(result.includes('world'));
  });
});

describe('trySampling', () => {
  it('returns ok:false when ctx is null', async () => {
    const result = await trySampling(null, {
      systemPrompt: 'test',
      userPrompt: 'test',
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('requestSampling'));
  });

  it('returns ok:false when mcpReq is missing', async () => {
    const result = await trySampling({}, {
      systemPrompt: 'test',
      userPrompt: 'test',
    });
    assert.equal(result.ok, false);
  });

  it('returns ok:false when requestSampling is not a function', async () => {
    const result = await trySampling({ mcpReq: {} }, {
      systemPrompt: 'test',
      userPrompt: 'test',
    });
    assert.equal(result.ok, false);
  });

  it('returns ok:true with parsed JSON when sampling succeeds', async () => {
    const mockCtx = {
      mcpReq: {
        requestSampling: async () => ({
          content: { type: 'text', text: '{"summary":"test result","reasoningNote":"mock"}' },
          model: 'test-model',
        }),
      },
    };

    const result = await trySampling(mockCtx, {
      systemPrompt: 'Return JSON.',
      userPrompt: 'Test prompt.',
    });
    assert.equal(result.ok, true);
    assert.equal(result.parsed.summary, 'test result');
  });
});
