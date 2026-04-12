let svg, circles, colorMap, featureScales, tooltip;
let _dpr = 1;
let _xScale, _yScale;
let _selectionMarker = null;

function _debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}



function initScatter(points, clusters) {
  console.log(clusters);
  colorMap = {};

  clusters.forEach((c) => {

    //colorMap[c.id] = c.color || COLOR_PALETTE_FALLBACK[i] || "#888";
    colorMap[c.id] = CLUSTER_COLORS[c.id];
  });

  featureScales = {};
  FEATURES.forEach(f => {
    const ext = d3.extent(points, d => d[f]);
    featureScales[f] = d3.scaleLinear().domain(ext).range([0, 1]);
  });

  const container = document.getElementById("scatter-plot");
  _dpr = window.devicePixelRatio || 1;
  const dpr = _dpr;
  const cssSize = Math.min(container.clientWidth, container.clientHeight);
  const plotSize = Math.round(cssSize * dpr);
  const margin = { top: 50 * dpr, right: 50 * dpr, bottom: 50 * dpr, left: 50 * dpr };
  const inner = plotSize - margin.left - margin.right;

  const xExt = d3.extent(points, d => d.pca_x);
  const yExt = d3.extent(points, d => d.pca_y);
  const lo = Math.min(xExt[0], yExt[0]);
  const hi = Math.max(xExt[1], yExt[1]);

  const x = d3.scaleLinear().domain([lo, hi]).range([margin.left, margin.left + inner]);
  const y = d3.scaleLinear().domain([lo, hi]).range([margin.top + inner, margin.top]);
  _xScale = x;
  _yScale = y;

  svg = d3.select("#scatter-plot")
    .append("svg")
    .attr("viewBox", `0 0 ${plotSize} ${plotSize}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "100%");

  const x0 = x(0), y0 = y(0);
  svg.append("g").attr("transform", `translate(0,${y0})`).call(d3.axisBottom(x).ticks(6));
  svg.append("g").attr("transform", `translate(${x0},0)`).call(d3.axisLeft(y).ticks(6));

  svg.append("text").attr("x", x0).attr("y", margin.top - 14 * dpr)
    .attr("text-anchor", "middle").attr("class", "axis-label").text("PC2");
  svg.append("text").attr("x", margin.left + inner + 14 * dpr).attr("y", y0 + 1.5)
    .attr("text-anchor", "start").attr("dominant-baseline", "middle").attr("class", "axis-label").text("PC1");

  circles = svg.selectAll(".point-circle")
    .data(points, d => d.hf_index)
    .enter().append("circle")
    .attr("class", "point-circle")
    .attr("cx", d => x(d.pca_x))
    .attr("cy", d => y(d.pca_y))
    .attr("r", 1.5 * dpr)
    .attr("fill", d => colorMap[d.cluster])
    .attr("opacity", SCATTER_SELECTED_OPACITY)
    .style("cursor", d => committedOpacity.get(d.hf_index) < 0.1 ? "default" : "pointer");

  // Legend
  const legendSpacing = 20 * dpr, sq = 13 * dpr, gap = 7 * dpr;
  const legendG = svg.append("g")
    .attr("class", "pca-legend")
    .attr("transform", `translate(${margin.left}, ${margin.top + inner - clusters.length * legendSpacing})`);

  const legendItems = legendG.selectAll(".legend-item")
    .data(clusters).join("g")
    .attr("class", "legend-item")
    .attr("data-cluster", d => d.id)
    .attr("transform", (d, i) => `translate(0,${i * legendSpacing})`)
    .style("cursor", "pointer");

  legendItems.append("rect")
    .attr("width", sq).attr("height", sq)
    .attr("fill", d => colorMap[d.id] || "#888");

  legendItems.append("text")
    .text(d => CLUSTER_NAMES[d.id])
    .attr("x", sq + gap).attr("y", sq / 2)
    .attr("dominant-baseline", "middle")
    .attr("class", "filters-text");

  const _legendPreview = _debounce(updatePreview, 40);

  legendItems
    .on("mouseover", (event, d) => {
      state.hoveredCluster = d.id;
      updateLegendAppearance();
      _legendPreview();
    })
    .on("mouseout", () => {
      state.hoveredCluster = null;
      updateLegendAppearance();
      updateVisuals();
    })
    .on("click", (event, d) => {
      state.selectedClusters.has(d.id)
        ? state.selectedClusters.delete(d.id)
        : state.selectedClusters.add(d.id);
      if (state.selectedClusters.size === clusters.length) state.selectedClusters.clear();
      updateLegendAppearance();
      applyFilter();
    });

  tooltip = d3.select("body").append("div")
    .attr("id", "tooltip");

  attachCircleHover(points);

  svg.on("mousemove", function (event) {
    const [mx, my] = d3.pointer(event, svg.node());

    let best = null;
    let bestDist = Infinity;

    for (const p of points) {
      if (committedOpacity.get(p.hf_index) < 0.1) continue;

      const dx = _xScale(p.pca_x) - mx;
      const dy = _yScale(p.pca_y) - my;
      const d = dx * dx + dy * dy;

      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }

    if (!best || bestDist > MAX_HOVER_DIST) {
      state.hoveredPoint = null;
      tooltip.style("opacity", 0);
      hideHoverRadar();
      return;
    }

    if (state.hoveredPoint?.hf_index === best.hf_index) return;

    state.hoveredPoint = best;

    tooltip
      .html(buildTooltipHTML(best))
      .style("opacity", 1)
      .style("left", (event.pageX + 10) + "px")
      .style("top", (event.pageY - 20) + "px");

    showHoverRadar(best);
  });

  document.addEventListener("click", e => {
    const interactive = "#scatter-plot, #filter-container, #radar, #trajectory-wrapper, #selected-point-info-wrapper, .pca-legend, .replay-btn";
    if (e.target.closest(interactive)) return;
    resetAll();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") resetAll(); });
}

function buildTooltipHTML(d) {
  return `
    <div class="tooltip-meta">#${d.hf_index} · ${d.game_type}</div>
    <div class="tooltip-cluster" style="color:${colorMap[d.cluster]}">${CLUSTER_NAMES[d.cluster]}</div>
    <div class="tooltip-grid">
      <span class="tooltip-dim">Speed</span><span>${d.speed_mean.toFixed(2)}</span>
      <span class="tooltip-dim">Efficiency</span><span>${d.path_efficiency.toFixed(2)}</span>
      <span class="tooltip-dim">Pause rate</span><span>${d.pause_rate.toFixed(2)}</span>
      <span class="tooltip-dim">Duration</span><span>${d.duration.toFixed(2)}</span>
      <span class="tooltip-dim">Anomaly</span><span>${d.anomaly_score.toFixed(2)}</span>
    </div>
  `;
}

function buildStatsCardHTML(d) {
  const clr = colorMap[d.cluster] || "#888";
  const gameLabel = GAME_FILTERS.find(f => f.game_type === d.game_type)?.label || d.game_type;
  const stats = [
    { label: "Speed", value: d.speed_mean.toFixed(2), unit: "px/tick" },
    { label: "Efficiency", value: d.path_efficiency.toFixed(2), unit: "" },
    { label: "Pause rate", value: d.pause_rate.toFixed(2), unit: "" },
    { label: "Duration", value: d.duration.toFixed(2), unit: "log-ms" },
    { label: "Anomaly", value: d.anomaly_score.toFixed(2), unit: "" },
  ];
  return `
    <div class="stats-card">
      <div class="stats-card-header">
        <span class="stats-cluster-pill" style="border-color:${clr};color:${clr}">${CLUSTER_NAMES[d.cluster]}</span>
        <span class="stats-meta">${gameLabel} &nbsp;·&nbsp; #${d.hf_index}</span>
      </div>
      <div class="stats-metrics">
        ${stats.map(s => `
          <div class="stats-metric">
            <span class="stats-label">${s.label}</span>
            <span class="stats-value">${s.value}</span>
            ${s.unit ? `<span class="stats-unit">${s.unit}</span>` : ""}
          </div>`).join("")}
      </div>
    </div>
  `;
}

function attachCircleHover(points) {
  circles.on("click", function (event, d) {
    if (+d3.select(this).style("opacity") < 0.1) return;

    event.stopPropagation();
    const id = d.hf_index;

    if (state.selectedPoint !== null && state.selectedPoint !== id) {
      _releasePointOpacity(state.selectedPoint, points);
      _removeSelectionMarker();
    }

    if (state.selectedPoint === id) {
      _releasePointOpacity(id, points);
      state.selectedPoint = null;
      _removeSelectionMarker();
      d3.select("#selected-point-info").html("").style("display", "none");
    } else {
      state.selectedPoint = id;
      committedOpacity.set(id, 1);
      _placeSelectionMarker(d);

      d3.select("#selected-point-info")
        .html(buildStatsCardHTML(d))
        .style("display", "block");

      renderMouseTrajectory(id, "trajectory-plot", "#trajectory-caption", points);
    }

    updateVisuals();
  });
}


// Release point back to correct filtered opacity
function _releasePointOpacity(hfIndex, points) {
  const pt = points.find(p => p.hf_index === hfIndex);
  if (!pt) return;

  const activeClusters = state.selectedClusters;
  const activeGameTypes = state.selectedGame
    ? new Set([GAME_ID_TO_TYPE[state.selectedGame]])
    : new Set();

  const isVisible = (activeClusters.size === 0 || activeClusters.has(pt.cluster)) &&
    (activeGameTypes.size === 0 || activeGameTypes.has(pt.game_type));

  committedOpacity.set(hfIndex, isVisible ? SCATTER_SELECTED_OPACITY : SCATTER_UNSELECTED_OPACITY);
}

function _placeSelectionMarker(d) {
  if (_selectionMarker) _selectionMarker.remove();
  const cx = _xScale(d.pca_x);
  const cy = _yScale(d.pca_y);
  const clr = colorMap[d.cluster] || "#fff";
  const baseR = SCATTER_SELECTED_R * _dpr;

  _selectionMarker = svg.append("g").attr("class", "selection-marker");

  const pulseCircle = _selectionMarker.append("circle")
    .attr("cx", cx).attr("cy", cy)
    .attr("r", baseR)
    .attr("fill", "none")
    .attr("stroke", SCATTER_SELECTED_STROKE)
    .attr("stroke-width", 1.5 * _dpr)
    .attr("opacity", 0.9)
    .attr("pointer-events", "none")
    .node();

  const animR = document.createElementNS("http://www.w3.org/2000/svg", "animate");
  animR.setAttribute("attributeName", "r");
  animR.setAttribute("from", baseR);
  animR.setAttribute("to", baseR * 5);
  animR.setAttribute("dur", "1.4s");
  animR.setAttribute("repeatCount", "indefinite");
  animR.setAttribute("calcMode", "spline");
  animR.setAttribute("keySplines", "0.2 0 0.8 1");
  pulseCircle.appendChild(animR);

  const animOp = document.createElementNS("http://www.w3.org/2000/svg", "animate");
  animOp.setAttribute("attributeName", "opacity");
  animOp.setAttribute("from", "0.8");
  animOp.setAttribute("to", "0");
  animOp.setAttribute("dur", "1.4s");
  animOp.setAttribute("repeatCount", "indefinite");
  animOp.setAttribute("calcMode", "spline");
  animOp.setAttribute("keySplines", "0.2 0 0.8 1");
  pulseCircle.appendChild(animOp);

  _selectionMarker.append("circle")
    .attr("cx", cx).attr("cy", cy)
    .attr("r", baseR)
    .attr("fill", clr)
    .attr("opacity", 0.25)
    .attr("pointer-events", "none");

  svg.selectAll(".point-circle").filter(p => p.hf_index === d.hf_index).raise();
}

function _removeSelectionMarker() {
  if (_selectionMarker) { _selectionMarker.remove(); _selectionMarker = null; }
}

function updateLegendAppearance() {
  svg.selectAll(".legend-item").each(function (d) {
    const g = d3.select(this);
    const isHovered = state.hoveredCluster === d.id;
    const isSelected = state.selectedClusters.has(d.id);
    g.select("text")
      .classed("hovered", isHovered)
      .classed("selected", isSelected);
    g.classed("selected", isSelected);
  });
}

function scatterApplyFilter(activeClusters, activeGameTypes) {
  const allCircles = svg.selectAll(".point-circle");
  if (state.selectedPoint !== null) {
    allCircles.filter(d => d.hf_index === state.selectedPoint).raise();
  }
  allCircles
    .attr("r", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_R * _dpr : 1.5 * _dpr)
    .attr("stroke", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE : "none")
    .attr("stroke-width", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE_W * _dpr : 0)
    .transition().duration(TRANSITION_MS).ease(TRANSITION_EASE)
    .attr("opacity", d => {
      if (d.hf_index === state.selectedPoint) return 1;
      const ok = (activeClusters.size === 0 || activeClusters.has(d.cluster)) &&
        (activeGameTypes.size === 0 || activeGameTypes.has(d.game_type));
      const op = ok ? SCATTER_SELECTED_OPACITY : SCATTER_UNSELECTED_OPACITY;
      committedOpacity.set(d.hf_index, op);
      return op;
    });
}

function updatePreview() {
  const effClusters = state.hoveredCluster != null
    ? new Set([...state.selectedClusters, state.hoveredCluster]) : state.selectedClusters;
  const effGame = state.hoveredGame ?? state.selectedGame ?? null;

  svg.selectAll(".point-circle")
    .transition().duration(HOVER_IN_MS)
    .attr("opacity", d => {
      if (d.hf_index === state.selectedPoint) return 1;
      const cur = committedOpacity.get(d.hf_index) ?? SCATTER_UNSELECTED_OPACITY;
      const cMatch = effClusters.size === 0 || effClusters.has(d.cluster);
      const gMatch = effGame == null || GAME_TYPE_TO_ID[d.game_type] === effGame;
      return (cMatch && gMatch) ? SCATTER_SELECTED_OPACITY : Math.min(cur, SCATTER_PREVIEW_OPACITY);
    });

  radarUpdatePreview(effClusters);
}

function updateVisuals() {
  const centroids = getFilteredCentroids();
  radarUpdate(centroids);

  const allCircles = svg.selectAll(".point-circle");
  if (state.selectedPoint !== null) allCircles.filter(d => d.hf_index === state.selectedPoint).raise();

  allCircles
    .attr("r", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_R * _dpr : 1.5 * _dpr)
    .attr("stroke", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE : "none")
    .attr("stroke-width", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE_W * _dpr : 0)
    .transition().duration(HOVER_OUT_MS).ease(TRANSITION_EASE)
    .attr("opacity", d => committedOpacity.get(d.hf_index) ?? SCATTER_UNSELECTED_OPACITY)
    .style("cursor", d => committedOpacity.get(d.hf_index) < 0.1 ? "default" : "pointer");
}