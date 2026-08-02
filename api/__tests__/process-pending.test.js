// api/__tests__/process-pending.test.js
'use strict';

const { getMinWordCount, validateBlueprintQuality } = require('../process-pending');

describe('process-pending quality validation', () => {
  test('scales blueprint minimums from a single-issue floor and caps them', () => {
    expect(getMinWordCount('blueprint', 1)).toBe(250);
    expect(getMinWordCount('blueprint', 2)).toBe(340);
    expect(getMinWordCount('blueprint', 8)).toBe(600);
  });

  test('uses the supplied minimum when validating content length', () => {
    const quality = validateBlueprintQuality('short response', 'blueprint', 250);
    expect(quality.valid).toBe(false);
    expect(quality.reason).toContain('Too short');
  });
});
