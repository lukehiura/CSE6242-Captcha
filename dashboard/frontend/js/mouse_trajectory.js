// ---------------- MOUSE TRAJECTORY FUNCTION ----------------
function renderMouseTrajectory(hfIndex, targetDivId, captionSelector) {
  // Fetch session from Flask backend
  d3.json(`http://127.0.0.1:5001/session/${hfIndex}`).then(session => {
    const tickInputs = session.ticks || [];
    const gameType = session.game_type;

    // Target container and caption
    const trajDiv = document.getElementById(targetDivId);
    if (!trajDiv) return console.warn(`Div ${targetDivId} not found`);
    trajDiv.innerHTML = ""; // clear previous SVG
    const trajectoryCaption = d3.select(captionSelector);

    if (tickInputs.length === 0) {
      trajDiv.innerHTML = "<p>No tick data.</p>";
      trajectoryCaption.html(`<strong>Game:</strong> ${gameType} &nbsp;|&nbsp; <strong>Session:</strong> ${hfIndex} — no ticks`);
      return;
    }

    // ---------------- CONFIG ----------------
    const CURSOR_UP_COLOR = "#ddd";
    const CURSOR_DOWN_COLOR = "black";
    const width = trajDiv.clientWidth;
    const height = trajDiv.clientHeight;
    const margin = {top: 20, right: 30, bottom: 40, left: 30};
    const MAX_TRAIL = 600;

    // ---------------- SVG ----------------
    const svg = d3.select(`#${targetDivId}`)
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
      .range([height - margin.bottom, margin.top]);

    // ---------------- CURSOR ----------------
    const cursor = svg.append("circle")
      .attr("r", 5)
      .attr("fill", CURSOR_UP_COLOR)
      .attr("opacity", 0.8);

    const trailData = [];

    // ---------------- LEGEND + SAMPLE LABEL ----------------
    const legendItems = [
      { label: "Mouse Up", color: CURSOR_UP_COLOR },
      { label: "Mouse Down", color: CURSOR_DOWN_COLOR }
    ];

    const spacing = 4, dotRadius = 5, textOffset = 4;

    const tempGroup = svg.append("g").attr("visibility", "hidden");
    const legendWidths = legendItems.map(item => {
      const text = tempGroup.append("text").text(item.label);
      const w = text.node().getBBox().width;
      text.remove();
      return dotRadius*2 + textOffset + w;
    });
    tempGroup.remove();
    const totalLegendWidth = legendWidths.reduce((a,b)=>a+b,0) + spacing*(legendItems.length-1);

    const sampleTextTemp = svg.append("text").text("Sample: 0000").attr("visibility","hidden");
    const sampleLabelWidth = sampleTextTemp.node().getBBox().width;
    sampleTextTemp.remove();
    const totalWidth = totalLegendWidth + 20 + sampleLabelWidth;

    const bottomGroup = svg.append("g")
      .attr("transform", `translate(${width/2 - totalWidth/2}, ${height - 20})`);
    let cursorX = 0;

    legendItems.forEach((item,i) => {
      bottomGroup.append("circle").attr("r", dotRadius).attr("fill", item.color)
        .attr("cx", cursorX + dotRadius).attr("cy", -dotRadius/4);
      bottomGroup.append("text").text(item.label)
        .attr("x", cursorX + dotRadius*2 + textOffset)
        .attr("y", 0)
        .attr("dominant-baseline", "middle")
        .attr("class", "legend-text");
      cursorX += legendWidths[i] + spacing;
    });

    const sampleText = bottomGroup.append("text")
      .text(`Sample: 0`)
      .attr("x", cursorX + 20)
      .attr("y", 0)
      .attr("dominant-baseline", "middle")
      .attr("class", "legend-text");

    // ---------------- ANIMATION ----------------
    let i = 0;
    function animateMouse() {
      if (i >= tickInputs.length) {
        setTimeout(() => {
          cursor.transition().duration(1500).attr("opacity", 0);
          sampleText.transition().duration(1500).attr("opacity", 0);
          svg.selectAll(".trail-segment").transition().duration(1500).attr("opacity", 0).remove();
        }, 5000);
        return;
      }

      const point = tickInputs[i];
      const px = xScale(point.x);
      const py = yScale(point.y);

      cursor.attr("cx", px).attr("cy", py)
        .attr("fill", point.isDown ? CURSOR_DOWN_COLOR : CURSOR_UP_COLOR)
        .attr("opacity", 0.8);

      trailData.push({x: px, y: py, isDown: point.isDown});
      if (trailData.length > MAX_TRAIL) trailData.shift();

      const segments = [];
      for (let j = 1; j < trailData.length; j++) {
        segments.push({
          x1: trailData[j-1].x,
          y1: trailData[j-1].y,
          x2: trailData[j].x,
          y2: trailData[j].y,
          opacity: j / trailData.length,
          isDown: trailData[j].isDown
        });
      }

      const lines = svg.selectAll(".trail-segment").data(segments);
      lines.enter().append("line").attr("class","trail-segment")
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

      sampleText.text(`Sample: ${point.sampleIndex}`).attr("opacity", 1);

      i++;
      requestAnimationFrame(animateMouse);
    }

    animateMouse();
  });
}

// ---------------- USAGE ----------------
// render session 0 in div #trajectory-plot with caption #trajectory-caption
renderMouseTrajectory(0, "trajectory-plot", "#trajectory-caption");