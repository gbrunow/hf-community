/**
 * How much of the studio an event takes, for the front of its title and the top of its
 * description. W is wheels, HB hand-building, G the glaze area. Wheels plus another area
 * name the area without a count, which in the sheet always matches the wheels.
 *
 * @param {string} wheels the "# of Wheels" cell as written
 * @param {string} handBuilding the "Hand-building" cell as written
 * @returns {{ label: string, detail: string } | null} null when the event takes no space
 */
function spaceLabel_(wheels, handBuilding) {
  const w = wheels.trim();
  const h = handBuilding.trim();
  if (!w && !h) return null;

  const number = /\d+/.exec(w)?.[0];
  const area = !h ? null : /glaze/i.test(h) ? 'G' : 'HB';
  let label = null;
  if (/glaze/i.test(w)) {
    // "15 people, mostly glaze area": a headcount in the glaze area, not wheels.
    label = number ? `${number} G` : 'G';
  } else if (number) {
    label = `${number} W` + (area ? ` + ${area}` : '');
  } else if (area === 'G') {
    label = /^all\b/i.test(h) ? 'all G' : 'G';
  } else if (area === 'HB') {
    const seats = /(\d+)\s*seats/i.exec(h)?.[1];
    label = seats
      ? `${seats} HB`
      : /^all of (hb|hand-?building)\b/i.test(h)
        ? 'all HB'
        : 'HB';
  }
  if (!label) return null;

  const parts = [];
  if (w) parts.push(/^\d+$/.test(w) ? `${w} wheels` : w);
  if (h) parts.push(h);
  return { label, detail: `Space taken: ${parts.join('; ')}` };
}
