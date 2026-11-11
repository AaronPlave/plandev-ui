import { describe, expect, test } from 'vitest';
import { EMBED_PROTOCOL, contextMessage, originOf, parseEmbedRequest } from './embedBridge';

describe('embedBridge', () => {
  test('originOf only accepts absolute http(s) URLs', () => {
    expect(originOf('http://localhost:8889/?mission=Mars')).toBe('http://localhost:8889');
    expect(originOf('https://example.com/a/b')).toBe('https://example.com');
    expect(originOf('javascript:alert(1)')).toBeNull();
    expect(originOf('/relative')).toBeNull();
    expect(originOf('')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });

  test('parseEmbedRequest validates protocol, type, and fields', () => {
    expect(parseEmbedRequest({ protocol: EMBED_PROTOCOL, type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseEmbedRequest({ protocol: EMBED_PROTOCOL, timeMs: 5, type: 'setTime' })).toEqual({
      timeMs: 5,
      type: 'setTime',
    });
    expect(parseEmbedRequest({ protocol: EMBED_PROTOCOL, timeMs: NaN, type: 'setTime' })).toBeNull();
    expect(parseEmbedRequest({ protocol: EMBED_PROTOCOL, spanId: 3, type: 'select' })).toEqual({
      directiveId: null,
      spanId: 3,
      type: 'select',
    });
    expect(parseEmbedRequest({ directiveId: 1.5, protocol: EMBED_PROTOCOL, type: 'select' })).toEqual({
      directiveId: null,
      spanId: null,
      type: 'select',
    });
    expect(parseEmbedRequest({ planId: 24, protocol: EMBED_PROTOCOL, type: 'openPlan' })).toEqual({
      planId: 24,
      type: 'openPlan',
    });
    expect(parseEmbedRequest({ planId: '24', protocol: EMBED_PROTOCOL, type: 'openPlan' })).toBeNull();
    expect(parseEmbedRequest({ protocol: 'other', type: 'ready' })).toBeNull();
    expect(parseEmbedRequest({ protocol: EMBED_PROTOCOL, type: 'getToken' })).toBeNull();
    expect(parseEmbedRequest('ready')).toBeNull();
  });

  test('contextMessage carries only identifiers and time', () => {
    const msg = contextMessage({
      planId: 7,
      planRevision: 3,
      selectedActivityDirectiveId: null,
      selectedSpanId: 12,
      simulationDatasetId: 9,
      timeMs: 1000,
    });
    expect(Object.keys(msg).sort()).toEqual([
      'planId',
      'planRevision',
      'protocol',
      'selectedActivityDirectiveId',
      'selectedSpanId',
      'simulationDatasetId',
      'timeMs',
      'type',
    ]);
  });
});
