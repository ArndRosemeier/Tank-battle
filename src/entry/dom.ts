/**
 * The ONE way to get a DOM node this app cannot run without.
 *
 * Why a helper instead of inline guards: TypeScript's control-flow narrowing is
 * **not preserved inside a nested function body**, so
 *
 *     const canvas = document.getElementById('app');
 *     if (!(canvas instanceof HTMLCanvasElement)) throw ...
 *     function resize() { canvas.width = 1; }        // error TS18047 here
 *
 * does not compile once the node is used from a function — which is almost always.
 * An explicit return type puts the narrow type on the value instead of on a control
 * flow path, so every caller is narrowed without a second check.
 *
 * Every lookup FAILS LOUDLY (AGENTS.md rule 1: no silent fallbacks): a missing node
 * is a broken page, not an optional element.
 */

/** Returns the element with `id` when it is of the expected kind, else throws. */
export function requireElement<T extends Element>(
  id: string,
  kind: abstract new (...args: never[]) => T,
  label: string,
): T {
  const element = document.getElementById(id);
  if (!(element instanceof kind)) {
    throw new Error(`dom: required ${label} #${id} is missing from the page`);
  }
  return element;
}

/** Returns a 2D context for `canvas`, else throws. */
export function requireContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('dom: 2D canvas context is unavailable');
  }
  return context;
}
