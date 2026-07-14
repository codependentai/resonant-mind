import { describe, expect, it } from 'vitest';
import { TOOLS, mcpToolHandlers } from '../src/mcp/registry';

describe('public MCP registry', () => {
  it('exposes the complete Reshape 2 surface without collisions', () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(names).toHaveLength(47);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(mcpToolHandlers).sort()).toEqual([...names].sort());
  });

  it('gives every tool a JSON object schema', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});
