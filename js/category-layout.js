(function(root) {
  'use strict';
  function create() {
    const offsets = new Map();
    return {
      position(category, index) { return index + (offsets.get(category) ?? 0); },
      move(category, offset) { if (Number.isFinite(offset)) offsets.set(category, offset); },
      restore(category) { offsets.delete(category); },
      domain(categories, width) {
        const gap = Math.min(200, width / (categories.length + .5));
        const span = Math.max(categories.length, width / gap);
        const center = (categories.length - 1) / 2;
        const positions = categories.map((category, index) => index + (offsets.get(category) ?? 0));
        return [Math.min(center - span / 2, ...positions.map(x => x - .5)),
          Math.max(center + span / 2, ...positions.map(x => x + .5))];
      },
      reset() { offsets.clear(); }
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = {create};
  else root.MetricsCategoryLayout = {create};
})(globalThis);
