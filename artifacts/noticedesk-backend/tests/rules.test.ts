import { describe, expect, it } from 'vitest';
import { NOTICE_TYPE_CONFIG, RULES, listUnverifiedRules } from '../src/lib/rules';

describe('rules table integrity', () => {
  it('every rule has an id matching its key, a description and at least one source', () => {
    for (const [key, rule] of Object.entries(RULES)) {
      expect(rule.id).toBe(key);
      expect(rule.description.length).toBeGreaterThan(20);
      expect(rule.sources.length).toBeGreaterThan(0);
    }
  });
  it('a rule marked verified names where it was checked and when', () => {
    for (const rule of Object.values(RULES).filter((r) => r.verified)) {
      expect(rule.verifiedOn, rule.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rule.verifiedFrom, rule.id).toBeDefined();
    }
  });
  it('every rule referenced by a notice type exists', () => {
    for (const cfg of Object.values(NOTICE_TYPE_CONFIG)) {
      for (const id of cfg.rulesUsed) expect(RULES[id], id).toBeDefined();
      for (const c of cfg.consequences) expect(RULES[c.ruleId], c.ruleId).toBeDefined();
      if (cfg.statutory) expect(RULES[cfg.statutory.ruleId]).toBeDefined();
    }
  });
  it('reply outlines mark every fact the user must supply', () => {
    for (const cfg of Object.values(NOTICE_TYPE_CONFIG)) {
      for (const section of cfg.replyOutline) expect(section.body.length).toBeGreaterThan(0);
      const joined = cfg.replyOutline.map((s) => s.body).join(' ');
      if (cfg.replyOutline.length > 0) expect(joined).toContain('[[FILL:');
    }
  });
  it('lists the unverified rules so the team can finish verifying them', () => {
    const ids = listUnverifiedRules().map((r) => r.id);
    expect(ids).toContain('R-LEGAL-NOTICE-GENERAL');
    expect(ids).toContain('R-IT-143-1-INFO');
  });
});
