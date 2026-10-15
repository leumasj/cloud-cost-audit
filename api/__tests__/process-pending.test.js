// api/__tests__/process-pending.test.js
'use strict';

const {
  buildBlueprintEmail,
  getMinWordCount,
  renderReportMarkdown,
  validateBlueprintQuality,
} = require('../process-pending');

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

  test('renders report Markdown into readable email sections and tables', () => {
    const html = renderReportMarkdown([
      '# Cost Blueprint',
      '',
      '## Savings Snapshot',
      '',
      '| Finding | Priority |',
      '| --- | --- |',
      '| **Idle resources** | High |',
      '',
      '1. Review the estimate.',
      '2. Verify the change with `aws ce get-cost-and-usage`.',
      '',
      '```bash',
      'aws s3 ls --profile <profile>',
      '```',
    ].join('\n'));

    expect(html).toContain('<h1');
    expect(html).toContain('<h2');
    expect(html).toContain('<table');
    expect(html).toContain('<strong style=');
    expect(html).toContain('<ol');
    expect(html).toContain('<code style=');
    expect(html).toContain('aws s3 ls --profile &lt;profile&gt;');
    expect(html).not.toContain('<profile>');
  });

  test('escapes raw HTML and leaves non-HTTP Markdown links inactive', () => {
    const html = renderReportMarkdown('<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))');

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('[unsafe](javascript:alert(1))');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
  });

  test('wraps the formatted report in a polished blueprint email with annualized savings', () => {
    const html = buildBlueprintEmail('# Plan\n\n## Next steps\n\n1. Verify the result.', {
      provider: 'AWS',
      savingsMin: 120,
      savingsMax: 240,
    });

    expect(html).toContain('Your Cost Optimization Blueprint');
    expect(html).toContain('Estimated monthly opportunity');
    expect(html).toContain('$120–$240');
    expect(html).toContain('Annualized opportunity');
    expect(html).toContain('$1,440–$2,880');
    expect(html).toContain('<h1');
    expect(html).toContain('<ol');
    expect(html).not.toContain('white-space:pre-wrap');
  });
});
