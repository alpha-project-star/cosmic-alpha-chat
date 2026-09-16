// tests/phase3n-audit.test.ts

import { describe, it, expect } from 'vitest';
import { shouldCaptureFrame } from '../src/lib/vision-command';
import { stripLeakedThinking } from '../src/lib/openai-compat';

describe('Phase 3N — Audit & Behavioral Integrity Tests', () => {
  describe('Eye / Vision Isolation', () => {
    it('does not trigger frame capture when images are already uploaded, even with vision query phrasing', () => {
      const text = 'what is this in the image?';
      const shouldCapture = shouldCaptureFrame(text, false, true);
      expect(shouldCapture).toBe(false);
    });

    it('triggers frame capture when eye is live and deictic phrasing is used without uploaded images', () => {
      const text = 'how does this look on me?';
      const shouldCapture = shouldCaptureFrame(text, true, false);
      expect(shouldCapture).toBe(true);
    });

    it('does not trigger frame capture when eye is off and no explicit vision command or uploaded image is present', () => {
      const text = 'hello alpha, how are you?';
      const shouldCapture = shouldCaptureFrame(text, false, false);
      expect(shouldCapture).toBe(false);
    });
  });

  describe('Internal Reasoning / Process Leakage Isolation', () => {
    it('strips <think> and <reasoning> blocks from model outputs', () => {
      const raw = '<think>Analyzing the request step by step...</think>Here is the final answer.';
      const clean = stripLeakedThinking(raw);
      expect(clean).toBe('Here is the final answer.');
    });

    it('strips thinking process Preamble blocks', () => {
      const raw = 'Thinking Process: 1. Understand query 2. Formulate response\n\nFinal Answer: Hello Alex!';
      const clean = stripLeakedThinking(raw);
      expect(clean).toBe('Hello Alex!');
    });
  });
});
