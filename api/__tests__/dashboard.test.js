'use strict';

const { countBlueprintOrders } = require('../dashboard');

describe('dashboard blueprint order count', () => {
  test('counts paid report product jobs without including sessions or follow-ups', async () => {
    const inFilter = jest.fn().mockResolvedValue({ count: 12, error: null });
    const select = jest.fn().mockReturnValue({ in: inFilter });
    const from = jest.fn().mockReturnValue({ select });
    const supabaseAdmin = { from };

    const result = await countBlueprintOrders(supabaseAdmin);

    expect(from).toHaveBeenCalledWith('delivery_queue');
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(inFilter).toHaveBeenCalledWith('product_type', [
      'blueprint',
      'security_blueprint',
      'bundle',
      'cfo_report',
      'ai_blueprint',
      'coding_tools_blueprint',
    ]);
    expect(result).toEqual({ count: 12, error: null });
  });
});
