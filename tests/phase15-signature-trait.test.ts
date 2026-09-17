import { describe, it, expect } from 'vitest';
import { ALPHA_SIGNATURE, expressSignatureTrait } from '../src/lib/signature-trait';
import { BehavioralContext } from '../src/lib/alpha-identity';

describe('Phase 15 - Signature Trait', () => {
  it('15.1 ALPHA_SIGNATURE structure', () => {
    expect(ALPHA_SIGNATURE).toBeDefined();
    expect(typeof ALPHA_SIGNATURE.voice).toBe('string');
    expect(typeof ALPHA_SIGNATURE.humorPolicy).toBe('string');
  });

  it('15.2 expressSignatureTrait context adaptation (high seriousness)', () => {
    const context: BehavioralContext = { seriousness: 'high', mode: 'normal' } as any;
    const expression = expressSignatureTrait(context);
    expect(expression).toContain('HIGH SERIOUSNESS');
    // Just test for the presence of the override.
    expect(expression).toContain('Style Override: HIGH SERIOUSNESS');
    expect(expression).not.toContain('Humor:'); // This is not in the base either.
    expect(expression).not.toContain('- Warmth:'); // This is in the final return, not base.
  });

  it('15.3 expressSignatureTrait context adaptation (action mode)', () => {
    const context: BehavioralContext = { seriousness: 'low', mode: 'action' } as any;
    const expression = expressSignatureTrait(context);
    expect(expression).toContain('ACTION');
    expect(expression).not.toContain('Humor');
  });

  it('15.4 expressSignatureTrait context adaptation (proactive mode)', () => {
    const context: BehavioralContext = { seriousness: 'low', mode: 'proactive' } as any;
    const expression = expressSignatureTrait(context);
    expect(expression).toContain('PROACTIVE');
  });

  it('15.5 expressSignatureTrait default mode (warmth/humor)', () => {
    const context: BehavioralContext = { seriousness: 'low', mode: 'normal' } as any;
    const expression = expressSignatureTrait(context);
    expect(expression).toContain('Warmth');
    expect(expression).toContain('Humor');
  });
});
