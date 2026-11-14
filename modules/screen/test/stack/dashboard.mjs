// The Dashboard's own checks on its stack shots (#405, #416; test/stack/screens.mjs): the boxes a
// missing source gives away, the showcase's strips, and statistics that never run together.

/**
 * Dashboard before the bot's data (contracts/screen.md, Boxes waiting for their source): Top games,
 * the activity graph and the voice rooms wait, and the hero fills their cells as for a showcase,
 * while Right now stays drawn, since its check-ins come from Notify (#443); no logo out of the
 * header. Right now's one number stands centred in its box (v8 rule 5): a box stretched over two
 * thirds of the screen once held it in a corner, with the hero squeezed into a strip.
 */
export async function boxesGivenAway(page) {
  const drawn = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const [frame, hero, stat, stats] = [
      box(".canccu-layout"),
      box(".canccu-region--hero"),
      box(".canccu-region--right_now .canccu-widget__stat"),
      box(".canccu-region--right_now"),
    ];
    const middle = (r) => r.left + r.width / 2;
    return {
      waiting: document.querySelectorAll(".canccu-region--top_games, .canccu-region--online, .canccu-region--voice").length,
      stats: document.querySelectorAll(".canccu-region > .canccu-widget--stats").length,
      logos: document.querySelectorAll('.canccu-region:not([data-role="header"]) > .canccu-widget--logo').length,
      heroGrown: frame !== null && hero !== null && hero.width > frame.width / 2 && hero.height > frame.height / 2,
      centred: stat !== null && stats !== null && Math.abs(middle(stat) - middle(stats)) < stats.width * 0.05,
    };
  }); // prettier-ignore
  const wrong =
    drawn.waiting > 0 || drawn.stats !== 1 || drawn.logos > 0 || !drawn.heroGrown || !drawn.centred;
  if (wrong) throw new Error(`the Dashboard before the bot's data: ${JSON.stringify(drawn)}`);
}

/** A strip's countdown says what it counts down to: its name drawn whole inside the strip. */
export async function stripNamesCountdown(page) {
  const sel = ".canccu-region--rail > .canccu-widget--countdown.canccu-is-active";
  await page.waitForSelector(sel, { timeout: 40_000 });
  const fits = await page.$eval(sel, (card) => {
    const name = card.querySelector(".canccu-widget__headline");
    if (name === null || name.textContent.trim() === "") return false;
    const [c, n] = [card.getBoundingClientRect(), name.getBoundingClientRect()];
    return n.height > 0 && n.top >= c.top && n.bottom <= c.bottom;
  });
  if (!fits) throw new Error("the showcase's rail strip draws its countdown without its name");
}

/**
 * Each statistic's number, arrow and label clear of the next one's (#416): in equal columns a long
 * number ran into its neighbour, and in a showcase strip the labels were drawn over the numbers.
 * An item's extent is what it draws, which may spill past its own box.
 */
export async function statsApart(page) {
  await page.waitForSelector(".canccu-widget--stats .canccu-widget__trend--up");
  const { boxes, u } = await page.evaluate(() => {
    // What is drawn: the text runs and the arrows. The number and its label are flex items as
    // wide as their column, so their own boxes say nothing about the text in them.
    const extent = (item) => {
      const walk = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      const rects = [...item.querySelectorAll(".canccu-widget__trend")].map((a) => a.getBoundingClientRect());
      for (let text = walk.nextNode(); text !== null; text = walk.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(text);
        rects.push(range.getBoundingClientRect());
      }
      const drawn = rects.filter((r) => r.width > 0);
      return {
        left: Math.min(...drawn.map((r) => r.left)), right: Math.max(...drawn.map((r) => r.right)),
        top: Math.min(...drawn.map((r) => r.top)), bottom: Math.max(...drawn.map((r) => r.bottom)),
      };
    };
    const items = (box) => [...box.querySelectorAll(".canccu-widget__stat")].map(extent);
    const unit = getComputedStyle(document.querySelector(".canccu-layout > *")).getPropertyValue("--canccu-u");
    return { boxes: [...document.querySelectorAll(".canccu-widget--stats")].map(items), u: parseFloat(unit) };
  }); // prettier-ignore
  if (!(u > 0)) throw new Error("the layout's --canccu-u is not a length");
  const problems = crowded(boxes, u);
  if (problems.length > 0)
    throw new Error(`the Dashboard's statistics run together: ${problems.join("; ")}`);
}

/**
 * The pairs of statistics on one line (their extents share some height) less than `gap` apart,
 * an overlap being a negative distance; one wrapped to a line of its own is apart.
 */
export function crowded(boxes, gap) {
  const problems = [];
  boxes.forEach((items, b) => {
    items.forEach((p, i) => {
      items.slice(i + 1).forEach((q, k) => {
        const oneLine = p.top < q.bottom && q.top < p.bottom;
        const apart = Math.max(q.left - p.right, p.left - q.right);
        if (oneLine && apart < gap)
          problems.push(
            `box ${b + 1}, items ${i + 1} and ${i + k + 2}: ${Math.round(apart)} px apart`,
          );
      });
    });
  });
  return problems;
}

/**
 * Each graph the screen shows draws its value scale and its hours (#523): three gridlines or more
 * with their values, and at least one hour named, all inside the graph's card. The top line sits
 * on the bars' box's top and the "0" line on the bars' feet, within 2 px, or the scale misreads
 * every bar (#524). Answers how many graphs it found, so a strip can tell that one of its frames
 * held one.
 */
export async function graphsScaled(page) {
  const graphs = await page.evaluate(() =>
    [...document.querySelectorAll(".canccu-widget.canccu-is-active .canccu-widget__graph")].map((graph) => {
      const card = graph.closest(".canccu-widget").getBoundingClientRect();
      const inside = (el) => {
        const r = el.getBoundingClientRect();
        return el.textContent.trim() !== "" && r.width > 0 && r.left >= card.left - 1 &&
          r.right <= card.right + 1 && r.top >= card.top - 1 && r.bottom <= card.bottom + 1;
      };
      const count = (sel) => [...graph.querySelectorAll(sel)].filter(inside).length;
      const middle = (el) => {
        const r = el.getBoundingClientRect();
        return (r.top + r.bottom) / 2;
      };
      const lines = [...graph.querySelectorAll(".canccu-widget__gridline")];
      const feet = Math.max(...[...graph.querySelectorAll(".canccu-widget__point")].map((p) => p.getBoundingClientRect().bottom));
      const top = graph.getBoundingClientRect().top + parseFloat(getComputedStyle(graph).paddingTop);
      return {
        lines: count(".canccu-widget__gridline"), hours: count(".canccu-widget__hour"),
        topOff: lines.length ? Math.round(middle(lines[0]) - top) : null,
        baseOff: lines.length ? Math.round(middle(lines[lines.length - 1]) - feet) : null,
      };
    }),
  ); // prettier-ignore
  const bare = graphs.filter((g) => g.lines < 3 || g.hours < 1);
  if (bare.length > 0)
    throw new Error(`a graph without its scale or hours: ${JSON.stringify(bare)}`);
  const off = graphs.filter((g) => Math.abs(g.topOff) > 2 || Math.abs(g.baseOff) > 2);
  if (off.length > 0)
    throw new Error(`a graph whose gridlines miss their values (px): ${JSON.stringify(off)}`);
  return graphs.length;
}
