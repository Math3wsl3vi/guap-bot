import { createStrategy } from '../../../src/strategies/StrategyFactory';
import { EMAScalpStrategy } from '../../../src/strategies/EMAScalpStrategy';
import { GridTradingStrategy } from '../../../src/strategies/GridTradingStrategy';

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('StrategyFactory', () => {
  describe('createStrategy()', () => {
    it('should create an EMAScalpStrategy for CONSERVATIVE', () => {
      const strategy = createStrategy('CONSERVATIVE');

      expect(strategy).toBeInstanceOf(EMAScalpStrategy);
      expect(strategy.name).toBe('Conservative EMA Scalp');
      expect(strategy.type).toBe('CONSERVATIVE');
    });

    it('should create a GridTradingStrategy for GRID_TRADING', () => {
      const strategy = createStrategy('GRID_TRADING');

      expect(strategy).toBeInstanceOf(GridTradingStrategy);
      expect(strategy.name).toBe('Grid Trading');
      expect(strategy.type).toBe('GRID_TRADING');
    });

    it('should fall back to CONSERVATIVE for unimplemented strategy types', () => {
      const strategy = createStrategy('AGGRESSIVE_SCALPING');

      expect(strategy).toBeInstanceOf(EMAScalpStrategy);
      expect(strategy.type).toBe('CONSERVATIVE');
    });

    it('should fall back to CONSERVATIVE for unknown types', () => {
      const strategy = createStrategy('NONEXISTENT' as any);

      expect(strategy).toBeInstanceOf(EMAScalpStrategy);
    });
  });
});
