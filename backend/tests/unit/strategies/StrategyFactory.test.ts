import { createStrategy } from '../../../src/strategies/StrategyFactory';
import { EMAScalpStrategy } from '../../../src/strategies/EMAScalpStrategy';
import { GridTradingStrategy } from '../../../src/strategies/GridTradingStrategy';
import { AggressiveScalpStrategy } from '../../../src/strategies/AggressiveScalpStrategy';
import { LondonBreakoutStrategy } from '../../../src/strategies/LondonBreakoutStrategy';
import { MeanReversionStrategy } from '../../../src/strategies/MeanReversionStrategy';
import { NewsEventStrategy } from '../../../src/strategies/NewsEventStrategy';
import { HybridStrategy } from '../../../src/strategies/HybridStrategy';

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

    it('should create an AggressiveScalpStrategy for AGGRESSIVE_SCALPING', () => {
      const strategy = createStrategy('AGGRESSIVE_SCALPING');

      expect(strategy).toBeInstanceOf(AggressiveScalpStrategy);
      expect(strategy.name).toBe('Aggressive Scalping');
      expect(strategy.type).toBe('AGGRESSIVE_SCALPING');
    });

    it('should create a LondonBreakoutStrategy for LONDON_BREAKOUT', () => {
      const strategy = createStrategy('LONDON_BREAKOUT');

      expect(strategy).toBeInstanceOf(LondonBreakoutStrategy);
      expect(strategy.name).toBe('London Breakout');
      expect(strategy.type).toBe('LONDON_BREAKOUT');
    });

    it('should create a MeanReversionStrategy for MEAN_REVERSION', () => {
      const strategy = createStrategy('MEAN_REVERSION');

      expect(strategy).toBeInstanceOf(MeanReversionStrategy);
      expect(strategy.name).toBe('Mean Reversion');
      expect(strategy.type).toBe('MEAN_REVERSION');
    });

    it('should create a NewsEventStrategy for NEWS_EVENT', () => {
      const strategy = createStrategy('NEWS_EVENT');

      expect(strategy).toBeInstanceOf(NewsEventStrategy);
      expect(strategy.name).toBe('News Event');
      expect(strategy.type).toBe('NEWS_EVENT');
    });

    it('should create a HybridStrategy for HYBRID', () => {
      const strategy = createStrategy('HYBRID');

      expect(strategy).toBeInstanceOf(HybridStrategy);
      expect(strategy.name).toBe('Hybrid (Time-Switched)');
      expect(strategy.type).toBe('HYBRID');
    });

    it('should fall back to CONSERVATIVE for unknown types', () => {
      const strategy = createStrategy('NONEXISTENT' as any);

      expect(strategy).toBeInstanceOf(EMAScalpStrategy);
    });
  });
});
