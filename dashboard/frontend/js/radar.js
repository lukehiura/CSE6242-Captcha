let radarSvg, centroidPaths, hoveredRadarPath, _radarRadius, _angleSlice;

function initRadar(points) {
  const container = d3.select("#radar");
  const W = container.node().clientWidth;
  const H = container.node().clientHeight;
  const rm = { top: 28, right: 50, bottom: 96, left: 50 };
  const innerW = W - rm.left - rm.right;
  const innerH = H - rm.top - rm.bottom;
  const size = Math.min(innerW, innerH);
  _radarRadius = size / 2;
  _angleSlice = 2 * Math.PI / FEATURES.length;
  const offX = rm.left + (innerW - size) / 2;
  const offY = rm.top  + (innerH - size) / 2;

  const root = container.append("svg")
    .attr("width", "100%").attr("height", "100%")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  radarSvg = root.append("g")
    .attr("transform", `translate(${offX + _radarRadius},${offY + _radarRadius})`);

  const legTop = H - rm.bottom + 38;
  const legG   = root.append("g").attr("class", "radar-legend");

  const item1W = 20;
  const item1Label = "Cluster avg";
  const item2W = 12;
  const item2Label = "Selected point";
  const fontSize = 11;
  const charW = fontSize * 0.52;
  const item1TotalW = item1W + 5 + item1Label.length * charW;
  const item2TotalW = item2W + 5 + item2Label.length * charW;
  const gap = 20;
  const totalLegW = item1TotalW + gap + item2TotalW;
  const legX = W / 2 - totalLegW / 2;

  legG.append("line")
    .attr("x1", legX).attr("y1", legTop)
    .attr("x2", legX + item1W).attr("y2", legTop)
    .attr("stroke", "#aaa").attr("stroke-width", 2);
  legG.append("text")
    .attr("x", legX + item1W + 5).attr("y", legTop)
    .attr("dominant-baseline", "middle")
    .attr("class", "filters-text")
    .style("font-size", `${fontSize}px`)
    .text(item1Label);

  const dx2 = legX + item1TotalW + gap;
  const dh  = 5;
  legG.append("polygon")
    .attr("points", `${dx2 + item2W/2},${legTop - dh} ${dx2 + item2W},${legTop} ${dx2 + item2W/2},${legTop + dh} ${dx2},${legTop}`)
    .attr("fill", "#aaa").attr("fill-opacity", 0.45)
    .attr("stroke", "#aaa").attr("stroke-width", 1);
  legG.append("text")
    .attr("x", dx2 + item2W + 5).attr("y", legTop)
    .attr("dominant-baseline", "middle")
    .attr("class", "filters-text")
    .style("font-size", `${fontSize}px`)
    .text(item2Label);

  for (let i = 1; i <= 4; i++) {
    radarSvg.append("circle")
      .attr("r", _radarRadius * (i / 4))
      .attr("fill", "none").attr("stroke", "#ccc").attr("stroke-dasharray", "2,2");
  }

  FEATURES.forEach((f, i) => {
    const a = i * _angleSlice - Math.PI / 2;
    radarSvg.append("line")
      .attr("x1", 0).attr("y1", 0)
      .attr("x2", Math.cos(a) * _radarRadius).attr("y2", Math.sin(a) * _radarRadius)
      .attr("stroke", "#999");
    radarSvg.append("text")
      .attr("x", Math.cos(a) * (_radarRadius + 18))
      .attr("y", Math.sin(a) * (_radarRadius + 18))
      .attr("text-anchor", "middle").attr("alignment-baseline", "middle")
      .attr("class", "filters-text")
      .style("font-size", "11px")
      .text(f);
  });

  hoveredRadarPath = radarSvg.append("path")
    .attr("class", "point-radar")
    .attr("fill", "none")
    .attr("stroke-width", RADAR_HOVER_STROKE_W)
    .attr("pointer-events", "none")
    .style("opacity", 0);
}

function _radarLine(values) {
  const scaled = values.map((v, i) => featureScales[FEATURES[i]](v));
  const closed = [...scaled, scaled[0]];
  return d3.lineRadial()
    .radius(v => v * _radarRadius)
    .angle((_, i) => i * _angleSlice)(closed);
}

function radarUpdate(centroids) {
  const joined = radarSvg.selectAll(".centroid-radar").data(centroids, d => d.cluster);

  joined.enter().append("path")
    .attr("class", "centroid-radar")
    .attr("fill", "none")
    .attr("stroke", d => colorMap[d.cluster])
    .attr("stroke-width", RADAR_STROKE_WIDTH)
    .attr("d", d => _radarLine(FEATURES.map(f => d[f])))
    .attr("opacity", 0)
    .transition().duration(TRANSITION_MS).ease(TRANSITION_EASE)
    .attr("opacity", RADAR_STROKE_OPACITY);

  joined
    .attr("stroke", d => colorMap[d.cluster])
    .attr("stroke-width", RADAR_STROKE_WIDTH)
    .transition().duration(TRANSITION_MS).ease(TRANSITION_EASE)
    .attr("d", d => _radarLine(FEATURES.map(f => d[f])))
    .attr("opacity", RADAR_STROKE_OPACITY);

  joined.exit()
    .transition().duration(TRANSITION_MS).ease(TRANSITION_EASE)
    .attr("opacity", 0).remove();

  centroidPaths = radarSvg.selectAll(".centroid-radar");
}

function radarUpdatePreview(effectiveClusters) {
  if (!centroidPaths) return;
  centroidPaths.transition().duration(HOVER_IN_MS)
    .attr("opacity", d => {
      const match = effectiveClusters.size === 0 || effectiveClusters.has(d.cluster);
      return match ? RADAR_STROKE_OPACITY : RADAR_PREVIEW_OPACITY;
    });
}

function showHoverRadar(d) {
  if (!hoveredRadarPath) return;
  hoveredRadarPath.transition().duration(HOVER_IN_MS)
    .attr("d", _radarLine(FEATURES.map(f => d[f])))
    .attr("stroke", colorMap[d.cluster])
    .attr("fill", colorMap[d.cluster])
    .attr("fill-opacity", RADAR_HOVER_FILL_OPY)
    .style("opacity", 1);
}

function hideHoverRadar() {
  if (!hoveredRadarPath) return;
  hoveredRadarPath.transition().duration(HOVER_OUT_MS).style("opacity", 0);
}
