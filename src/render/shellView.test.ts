import { describe, expect, it } from 'vitest';
import { createShellView } from './shellView.ts';

function shell(overrides: Partial<Parameters<ReturnType<typeof createShellView>['update']>[0][number]> = {}) {
  return {
    id: 7,
    ownerTankId: 0,
    ownerTeamId: 0,
    x: 10,
    y: 1.3,
    z: 12,
    dx: 0,
    dy: 0,
    dz: -1,
    travelledMetres: 4,
    ...overrides,
  };
}

describe('rocket shells', () => {
  it('adds a low-poly rocket instance and keeps the budgeted triangle count', () => {
    const view = createShellView();
    try {
      view.update([shell()]);
      expect(view.rockets.visible).toBe(true);
      expect(view.rockets.count).toBe(1);
      const index = view.rockets.geometry.getIndex();
      const triangles = index ? index.count / 3 : view.rockets.geometry.getAttribute('position').count / 3;
      expect(triangles).toBeGreaterThan(0);
      expect(triangles).toBeLessThanOrEqual(60);
      expect(view.group.children).toHaveLength(2); // trail lines + one instanced rocket mesh
    } finally {
      view.dispose();
    }
  });

  it('hides the rocket buffer when no shells are in flight', () => {
    const view = createShellView();
    try {
      view.update([]);
      expect(view.rockets.visible).toBe(false);
      expect(view.rockets.count).toBe(0);
    } finally {
      view.dispose();
    }
  });
});
