import { describe, expect, it } from 'vitest';
import { ScoreCalibrator, DEFAULT_CONFIDENCE_THRESHOLD } from '@server/search/ScoreCalibrator';

describe('search/ScoreCalibrator', () => {
  describe('lengthNormalizationFactor', () => {
    it('returns 1.0 for single-word queries', () => {
      expect(ScoreCalibrator.lengthNormalizationFactor(1)).toBe(1.0);
      expect(ScoreCalibrator.lengthNormalizationFactor(0)).toBe(1.0);
    });

    it('scales sub-linearly with query length', () => {
      const d3 = ScoreCalibrator.lengthNormalizationFactor(3);
      const d5 = ScoreCalibrator.lengthNormalizationFactor(5);
      const d10 = ScoreCalibrator.lengthNormalizationFactor(10);

      expect(d3).toBeGreaterThan(1.5);
      expect(d5).toBeGreaterThan(d3);
      expect(d10).toBeGreaterThan(d5);
      // Sub-linear: 10 tokens factor should be less than 10
      expect(d10).toBeLessThan(6.0);
    });
  });

  describe('calibrateConfidence', () => {
    it('returns 0 for non-positive raw scores', () => {
      expect(ScoreCalibrator.calibrateConfidence(0, 1)).toBe(0);
      expect(ScoreCalibrator.calibrateConfidence(-5, 3)).toBe(0);
    });

    it('calibrates single-word precise matches with high confidence', () => {
      // Single-word match with raw score 3.8 (e.g. "hover" -> page_hover)
      const conf = ScoreCalibrator.calibrateConfidence(3.8, 1);
      expect(conf).toBeGreaterThan(0.85);
      expect(conf).toBeLessThanOrEqual(1.0);
    });

    it('penalizes weak accidental matches on long queries', () => {
      // Long 5-word query with spurious weak match score 1.8
      const conf = ScoreCalibrator.calibrateConfidence(1.8, 5);
      expect(conf).toBeLessThan(DEFAULT_CONFIDENCE_THRESHOLD);
    });

    it('accepts strong multi-word matches', () => {
      // Long 5-word query with genuine strong match score 25.0
      const conf = ScoreCalibrator.calibrateConfidence(25.0, 5);
      expect(conf).toBeGreaterThan(0.95);
    });
  });

  describe('isConfidentMatch', () => {
    it('accepts valid single-word tool hits', () => {
      expect(ScoreCalibrator.isConfidentMatch(3.5, 1)).toBe(true);
    });

    it('rejects low-score multi-word noise', () => {
      expect(ScoreCalibrator.isConfidentMatch(1.7, 5)).toBe(false);
      expect(ScoreCalibrator.isConfidentMatch(1.2, 4)).toBe(false);
    });
  });
});
