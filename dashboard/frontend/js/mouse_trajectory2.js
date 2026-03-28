// ---------------- FULL MOUSE TRAJECTORY ----------------
d3.json("data/sheep_herd_test_session.json").then(data => {

  const tickInputs = data.tickInputs; // array of {x, y, isDown, sampleIndex}

  // ---------------- CONFIGURABLE COLORS ----------------
  const CURSOR_UP_COLOR = "#ddd";
  const CURSOR_DOWN_COLOR = "black";

  const trajDiv = document.getElementById("trajectory-plot");
  const width = trajDiv.clientWidth;
  const height = trajDiv.clientHeight;
  const margin = {top: 20, right: 20, bottom: 40, left: 20}; // extra bottom margin

  // ---------------- SVG ----------------
  const svg = d3.select("#trajectory-plot")
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  // ---------------- SCALES ----------------
  const xScale = d3.scaleLinear()
    .domain(d3.extent(tickInputs, d => d.x))
    .range([margin.left, width - margin.right]);

  const yScale = d3.scaleLinear()
    .domain(d3.extent(tickInputs, d => d.y))
    .range([height - margin.bottom, margin.top]); // flip Y

  // ---------------- CURSOR ----------------
  const cursor = svg.append("circle")
    .attr("r", 5)
    .attr("fill", CURSOR_UP_COLOR)
    .attr("opacity", 0.8);

  // ---------------- TRAIL ----------------
  const trailData = [];
  const MAX_TRAIL = 600; // adjustable tail length

  // ---------------- CENTERED LEGEND + SAMPLE LABEL ----------------
// ---------------- CENTERED LEGEND + SAMPLE LABEL ----------------
const legendItems = [
  { label: "Mouse Up", color: CURSOR_UP_COLOR },
  { label: "Mouse Down", color: CURSOR_DOWN_COLOR }
];

const spacing = 10;       // space between items
const dotRadius = 6;
const textOffset = 5;
const fontSize = 12;

// Create a temporary group to measure text widths
const tempGroup = svg.append("g").attr("visibility", "hidden");
const legendWidths = legendItems.map(item => {
  const text = tempGroup.append("text")
    .text(item.label)
    .style("font-size", `${fontSize}px`);
  const width = text.node().getBBox().width;
  text.remove();
  return dotRadius*2 + textOffset + width;
});
tempGroup.remove();

const totalLegendWidth = legendWidths.reduce((a,b)=>a+b,0) + spacing*(legendItems.length-1);

// Sample label width
const sampleFontSize = 12;
const sampleTextTemp = svg.append("text")
  .text("Sample: 0000")
  .style("font-size", `${sampleFontSize}px`)
  .attr("visibility","hidden");
const sampleLabelWidth = sampleTextTemp.node().getBBox().width;
sampleTextTemp.remove();

const totalWidth = totalLegendWidth + 20 + sampleLabelWidth; // 20px gap between legend and sample label

// Bottom group
const bottomGroup = svg.append("g")
  .attr("transform", `translate(${width/2 - totalWidth/2}, ${height - 20})`); // 20px from bottom

let cursorX = 0;

// Add legend items
legendItems.forEach((item,i) => {
  // Dot
  bottomGroup.append("circle")
    .attr("r", dotRadius)
    .attr("fill", item.color)
    .attr("cx", cursorX + dotRadius)
    .attr("cy", 0);

  // Text
  const textEl = bottomGroup.append("text")
    .text(item.label)
    .attr("x", cursorX + dotRadius*2 + textOffset)
    .attr("y", 0)
    .style("font-size", `${fontSize}px`)
    .attr("dominant-baseline", "middle");

  cursorX += legendWidths[i] + spacing;
});

// Add sample label to the right of legend
const sampleText = bottomGroup.append("text")
  .text("Sample: 0")
  .attr("x", cursorX + 20) // gap of 20px
  .attr("y", 0)
  .style("font-size", `${sampleFontSize}px`)
  .attr("dominant-baseline", "middle");

  // ---------------- ANIMATION ----------------
  let i = 0;
  function animateMouse() {
    if (i >= tickInputs.length) return;

    const point = tickInputs[i];
    const px = xScale(point.x);
    const py = yScale(point.y);

    // Move cursor
    cursor
      .attr("cx", px)
      .attr("cy", py)
      .attr("fill", point.isDown ? CURSOR_DOWN_COLOR : CURSOR_UP_COLOR);

    // Update trail
    trailData.push({x:px, y:py, isDown:point.isDown});
    if (trailData.length > MAX_TRAIL) trailData.shift();

    // Draw segments with fading opacity
    const segments = [];
    for (let j = 1; j < trailData.length; j++) {
      segments.push({
        x1: trailData[j-1].x,
        y1: trailData[j-1].y,
        x2: trailData[j].x,
        y2: trailData[j].y,
        opacity: j / trailData.length, // older points fade out
        isDown: trailData[j].isDown
      });
    }

    const lines = svg.selectAll(".trail-segment").data(segments);
    lines.enter()
      .append("line")
      .attr("class","trail-segment")
      .merge(lines)
      .attr("x1", d=>d.x1)
      .attr("y1", d=>d.y1)
      .attr("x2", d=>d.x2)
      .attr("y2", d=>d.y2)
      .attr("stroke", d=>d.isDown ? CURSOR_DOWN_COLOR : CURSOR_UP_COLOR)
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", d=>d.isDown ? "0" : "4,2")
      .attr("opacity", d=>d.opacity);

    lines.exit().remove();

    // Update sample label
    sampleText.text(`Sample: ${point.sampleIndex}`);

    i++;
    requestAnimationFrame(animateMouse);
  }

  animateMouse();

});