/**
 * How many people an event has room for, for the end of its title, and a block listing the
 * space it takes, for the top of its description. A class takes the same number of wheels,
 * seats or glaze-area places for each person, so the title shows just that number.
 *
 * @param {string} wheels the "# of Wheels" cell as written
 * @param {string} handBuilding the "Hand-building" cell as written
 * @returns {{ label: string, detail: string } | null} null when the cells say nothing about
 *   space; the label is empty when they give no number ("all of HB")
 */
function spaceLabel_(wheels, handBuilding) {
  const w = wheels.trim();
  const h = handBuilding.trim();

  const wheelCount = /\d+/.exec(w)?.[0];
  const seatCount = /(\d+)\s*seats/i.exec(h)?.[1];
  const label = [wheelCount, seatCount].find((count) => Number(count) > 0) ?? '';

  // The sheet files glazing under both columns ("15 people, mostly glaze area", "all of
  // glaze area"), so it is a note on the class rather than a line for either column.
  const glazingInWheels = /glaze/i.test(w);
  const glazing = glazingInWheels || /glaze/i.test(h);

  const lines = [];
  if (glazingInWheels) {
    if (wheelCount) lines.push(render_(CONTENT.space.people, { value: wheelCount }));
  } else if (w && !/^0+$/.test(w)) {
    // A 0 in the wheels column means the class takes none.
    lines.push(render_(CONTENT.space.wheels, { value: w }));
  }
  if (h && !/glaze/i.test(h)) {
    lines.push(
      /^hand-?building$/i.test(h)
        ? CONTENT.space.handBuildingArea
        : render_(CONTENT.space.handBuilding, { value: h }),
    );
  }
  if (glazing) lines.push(CONTENT.space.glazing);
  if (!lines.length) return null;

  return { label, detail: [CONTENT.space.heading, ...lines].join('\n') };
}
