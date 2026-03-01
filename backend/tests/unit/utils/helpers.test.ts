import { parseEnvNumber, requireEnv } from '../../../src/utils/helpers';

describe('helpers', () => {
  describe('parseEnvNumber()', () => {
    it('should return the parsed number when valid', () => {
      expect(parseEnvNumber('42', 0)).toBe(42);
      expect(parseEnvNumber('3.14', 0)).toBe(3.14);
      expect(parseEnvNumber('0', 10)).toBe(0);
    });

    it('should return the fallback when undefined', () => {
      expect(parseEnvNumber(undefined, 42)).toBe(42);
    });

    it('should return the fallback when not a valid number', () => {
      expect(parseEnvNumber('abc', 42)).toBe(42);
      expect(parseEnvNumber('', 42)).toBe(42);
    });

    it('should handle negative numbers', () => {
      expect(parseEnvNumber('-5', 0)).toBe(-5);
      expect(parseEnvNumber('-0.5', 0)).toBe(-0.5);
    });
  });

  describe('requireEnv()', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should return the env var value when set', () => {
      process.env.TEST_VAR = 'hello';
      expect(requireEnv('TEST_VAR')).toBe('hello');
    });

    it('should throw when env var is not set', () => {
      delete process.env.MISSING_VAR;
      expect(() => requireEnv('MISSING_VAR')).toThrow(
        'Missing required environment variable: MISSING_VAR',
      );
    });

    it('should throw when env var is empty string', () => {
      process.env.EMPTY_VAR = '';
      expect(() => requireEnv('EMPTY_VAR')).toThrow(
        'Missing required environment variable: EMPTY_VAR',
      );
    });
  });
});
