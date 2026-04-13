let radarSvg, centroidPaths, hoveredRadarPath, _radarRadius, _angleSlice;

function initRadar(points) {
  const container = d3.select("#radar");
  const W = container.node().clientWidth;
  const H = container.node().clientHeight;

  const rm = { top: 18, right: 28, bottom: 42, left: 28 };
  const innerW = W - rm.left - rm.right;
  const innerH = H - rm.top - rm.bottom;

  const size = Math.min(innerW, innerH);
  _radarRadius = size / 2;
  _angleSlice = (2 * Math.PI) / FEATURES.length;

  const offX = rm.left + (innerW - size) / 2;
  const offY = rm.top + (innerH - size) / 2;

  const root = container.append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  radarSvg = root.append("g")
    .attr("transform", `translate(${offX + _radarRadius},${offY + _radarRadius})`);

  // =========================
  // LEGEND (no extra text classes needed)
  // =========================

  const legTop = H ;
  const legG = root.append("g").attr("class", "radar-legend");

  const legend = [
    { type: "line", label: "Cluster avg", width: 20 },
    { type: "diamond", label: "Point preview", width: 12 }
  ];

  const fontSize = 11;
  const charW = fontSize * 0.52;
  const gap = 20;

  const itemWidth = d => d.width + 5 + d.label.length * charW;

  const totalLegW =
    legend.reduce((sum, d) => sum + itemWidth(d), 0) + gap;

  let cursorX = W / 2 - totalLegW / 2;

  legend.forEach(d => {
    const w = d.width;
    const fullW = itemWidth(d);

    if (d.type === "line") {
      legG.append("line")
        .attr("x1", cursorX)
        .attr("y1", legTop)
        .attr("x2", cursorX + w)
        .attr("y2", legTop)
        .attr("stroke", "var(--text-lo)")
        .attr("stroke-width", 2);
    }

    if (d.type === "diamond") {
      legG.append("polygon")
        .attr(
          "points",
          `${cursorX + w / 2},${legTop - 5}
       ${cursorX + w},${legTop}
       ${cursorX + w / 2},${legTop + 5}
       ${cursorX},${legTop}`
        )
        .attr("fill", "var(--text-hi)")
        .attr("fill-opacity", 0.6)
        .attr("stroke", "var(--text-hi)")
        .attr("stroke-width", 1)
        .attr("vector-effect", "non-scaling-stroke");
    }

    // IMPORTANT: no radar-specific class — uses global svg text styling
    legG.append("text")
      .attr("class", "radar-legend-label")
      .attr("x", cursorX + w + 5)
      .attr("y", legTop)
      .attr("dominant-baseline", "middle")
      .text(d.label);

    cursorX += fullW + gap;
  });

  // =========================
  // RADAR GRID (isolated by CSS classes only)
  // =========================

  for (let i = 1; i <= 4; i++) {
    radarSvg.append("circle")
      .attr("r", _radarRadius * (i / 4))
      .attr("class", "axis-line radar-grid-ring")
      .attr("fill", "none");
  }

  FEATURES.forEach((f, i) => {
    const a = i * _angleSlice - Math.PI / 2;

    radarSvg.append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", Math.cos(a) * _radarRadius)
      .attr("y2", Math.sin(a) * _radarRadius)
      .attr("class", "axis-line radar-grid-spoke");

    radarSvg.append("text")
      .attr("x", Math.cos(a) * (_radarRadius + 18))
      .attr("y", Math.sin(a) * (_radarRadius + 18))
      .attr("text-anchor", "middle")
      .attr("alignment-baseline", "middle")
      .attr("class", "radar-axis-label")
      .text(f);
  });

  // =========================
  // HOVER PATH
  // =========================

  hoveredRadarPath = radarSvg.append("path")
    .attr("class", "radar-hover-path")
    .attr("fill", "none")
    .attr("stroke-width", RADAR_HOVER_STROKE_W)
    .attr("pointer-events", "none")
    .style("opacity", 0);
}

function _radarLine(values) {
  const scaled = values.map((v, i) =>
    featureScales[FEATURES[i]](v)
  );

  const closed = [...scaled, scaled[0]];

  return d3.lineRadial()
    .radius(v => v * _radarRadius)
    .angle((_, i) => i * _angleSlice)(closed);
}

function radarUpdate(centroids) {
  const joined = radarSvg
    .selectAll(".centroid-radar")
    .data(centroids, d => d.cluster);

  joined.enter()
    .append("path")
    .attr("class", "centroid-radar")
    .attr("fill", "none")
    .attr("stroke", d => colorMap[d.cluster])
    .attr("stroke-width", RADAR_STROKE_WIDTH)
    .attr("d", d => _radarLine(FEATURES.map(f => d[f])))
    .attr("opacity", 0)
    .transition()
    .duration(TRANSITION_MS)
    .ease(TRANSITION_EASE)
    .attr("opacity", RADAR_STROKE_OPACITY);

  joined
    .attr("stroke", d => colorMap[d.cluster])
    .attr("stroke-width", RADAR_STROKE_WIDTH)
    .transition()
    .duration(TRANSITION_MS)
    .ease(TRANSITION_EASE)
    .attr("d", d => _radarLine(FEATURES.map(f => d[f])))
    .attr("opacity", RADAR_STROKE_OPACITY);

  joined.exit()
    .transition()
    .duration(TRANSITION_MS)
    .ease(TRANSITION_EASE)
    .attr("opacity", 0)
    .remove();

  centroidPaths = radarSvg.selectAll(".centroid-radar");
}

function radarUpdatePreview(effectiveClusters) {
  if (!centroidPaths) return;

  centroidPaths.transition()
    .duration(HOVER_IN_MS)
    .attr("opacity", d => {
      const match =
        effectiveClusters.size === 0 ||
        effectiveClusters.has(d.cluster);

      return match
        ? RADAR_STROKE_OPACITY
        : RADAR_PREVIEW_OPACITY;
    });
}

function showHoverRadar(d) {
  if (!hoveredRadarPath) return;

  hoveredRadarPath.transition()
    .duration(HOVER_IN_MS)
    .attr("d", _radarLine(FEATURES.map(f => d[f])))
    .attr("stroke", colorMap[d.cluster])
    .attr("fill", colorMap[d.cluster])
    .attr("fill-opacity", RADAR_HOVER_FILL_OPY)
    .style("opacity", 1);

  hoveredRadarPath.raise();
}

function hideHoverRadar() {
  if (!hoveredRadarPath) return;

  hoveredRadarPath.transition()
    .duration(HOVER_OUT_MS)
    .style("opacity", 0);
}