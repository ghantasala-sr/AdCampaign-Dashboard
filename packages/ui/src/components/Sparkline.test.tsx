import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { Sparkline } from './Sparkline.js';

/**
 * The sparkline is rendered once per table row, so its DOM cost is multiplied by
 * the row count. The contract worth pinning is that a series of any length
 * produces exactly one element — the naive baseline's one-circle-per-point
 * version is what makes a 10,000-row table unscrollable.
 */

function paths(container: HTMLElement): SVGPathElement[] {
  return Array.from(container.querySelectorAll('path'));
}

describe('Sparkline', () => {
  it('draws a 30-point series as a single path', () => {
    const values = Array.from({ length: 30 }, (_, i) => i * 3);
    const { container } = render(<Sparkline values={values} />);

    expect(paths(container)).toHaveLength(1);
    // 30 points, one element: 10,000 rows costs 10,000 nodes here, not 300,000.
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });

  it('emits one command per point', () => {
    const { container } = render(<Sparkline values={[1, 2, 3, 4]} />);
    const d = paths(container)[0]?.getAttribute('d') ?? '';
    expect(d.startsWith('M')).toBe(true);
    expect(d.match(/L/g)).toHaveLength(3);
  });

  it('centres a flat series instead of dividing by zero', () => {
    // A campaign with constant spend has zero range; a naive normalisation
    // produces NaN coordinates and the path silently disappears.
    const { container } = render(<Sparkline values={[5, 5, 5, 5]} height={20} />);
    const d = paths(container)[0]?.getAttribute('d') ?? '';
    expect(d).not.toContain('NaN');
    expect(d).toContain('10.00');
  });

  it('handles a single point without producing an empty path', () => {
    const { container } = render(<Sparkline values={[42]} />);
    const d = paths(container)[0]?.getAttribute('d') ?? '';
    expect(d).not.toBe('');
    expect(d).not.toContain('NaN');
  });

  it('renders nothing drawable for an empty series but does not crash', () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(paths(container)[0]?.getAttribute('d')).toBe('');
  });

  it('keeps every point inside the viewBox', () => {
    const height = 20;
    const { container } = render(<Sparkline values={[0, 100, 50]} height={height} />);
    const d = paths(container)[0]?.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/,(\d+\.\d+)/g)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(height);
    }
  });

  it('is presentational unless given a label', () => {
    const { container } = render(<Sparkline values={[1, 2]} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    const labelled = render(<Sparkline values={[1, 2]} label="Spend trend for X" />);
    expect(labelled.container.querySelector('svg')).toHaveAttribute('role', 'img');
    expect(labelled.container.querySelector('svg')).toHaveAttribute(
      'aria-label',
      'Spend trend for X',
    );
  });

  it('colours by direction of travel', () => {
    const up = render(<Sparkline values={[1, 10]} />);
    expect(up.container.querySelector('path')?.getAttribute('class')).toContain('emerald');

    const down = render(<Sparkline values={[10, 1]} />);
    expect(down.container.querySelector('path')?.getAttribute('class')).toContain('rose');
  });
});
