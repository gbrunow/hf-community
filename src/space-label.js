/**
 * How many people an event has room for, for the end of its title, and the words for the
 * top of its description. A class takes the same number of wheels, seats or glaze-area
 * places for each person, so the title shows just that number.
 *
 * @param {string} wheels the "# of Wheels" cell as written
 * @param {string} handBuilding the "Hand-building" cell as written
 * @returns {{ label: string, detail: string } | null} null when the event takes no space; the
 *   label is empty when the cells give no number ("all of HB")
 */
function spaceLabel_(wheels, handBuilding) {
  const w = wheels.trim();
  const h = handBuilding.trim();
  if (!w && !h) return null;

  // A 0 in the wheels column means the class takes none.
  const wheelCount = /\d+/.exec(w)?.[0];
  const seatCount = /(\d+)\s*seats/i.exec(h)?.[1];
  const label = [wheelCount, seatCount].find((count) => Number(count) > 0) ?? '';

  const parts = [];
  if (w) parts.push(/^\d+$/.test(w) ? `${w} wheels` : w);
  if (h) parts.push(h);
  return { label, detail: `Space taken: ${parts.join('; ')}` };
}
