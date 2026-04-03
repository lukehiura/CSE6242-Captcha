let svg, circles, colorMap, featureScales, tooltip;
let _dpr = 1;

function _debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function initScatter(points, clusters) {
  colorMap = {};
  clusters.forEach((c, i) => {
    colorMap[c.id] = c.color || COLOR_PALETTE_FALLBACK[i] || "#888";
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
    .attr("text-anchor", "middle").style("font-size", `${15 * dpr}px`).style("fill", "#bbb").text("PC1");
  svg.append("text").attr("x", margin.left + inner + 14 * dpr).attr("y", y0 + 1.5)
    .attr("text-anchor", "start").attr("dominant-baseline", "middle").style("font-size", `${15 * dpr}px`).style("fill", "#bbb").text("PC2");

  circles = svg.selectAll(".point-circle")
    .data(points, d => d.hf_index)
    .enter().append("circle")
    .attr("class", "point-circle")
    .attr("cx", d => x(d.pca_x))
    .attr("cy", d => y(d.pca_y))
    .attr("r", 1.5 * dpr)
    .attr("fill", d => colorMap[d.cluster])
    .attr("opacity", SCATTER_SELECTED_OPACITY)
    .style("cursor", "pointer");

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
    .attr("fill", d => colorMap[d.id] || "#888")
    .attr("stroke", "#333").attr("stroke-width", 1);

  legendItems.append("text")
    .text(d => CLUSTER_NAMES[d.id])
    .attr("x", sq + gap).attr("y", sq / 2)
    .attr("dominant-baseline", "middle")
    .attr("class", "filters-text")
    .style("font-size", `${13 * dpr}px`);

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
    .attr("id", "tooltip")
    .style("position", "absolute")
    .style("pointer-events", "none")
    .style("opacity", 0)
    .style("z-index", 9999)
    .style("background", "rgba(0,0,0,0.7)")
    .style("color", "white")
    .style("padding", "6px")
    .style("border-radius", "4px")
    .style("font-size", "0.85rem")
    .style("transition", "opacity 0.15s")
    .style("white-space", "normal")
    .style("max-width", "250px");

  attachCircleHover(points);

  document.addEventListener("click", e => {
    const interactive = "#scatter-plot, #filter-container, #radar, #trajectory-wrapper, #selected-point-info-wrapper, .pca-legend, .replay-btn";
    if (e.target.closest(interactive)) return;
    resetAll();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") resetAll(); });
}

function buildTooltipHTML(d) {
  return `
    <div style="font-size:0.75rem;opacity:0.7;margin-bottom:2px">#${d.hf_index} · ${d.game_type}</div>
    <div style="font-weight:bold;color:${colorMap[d.cluster]};margin-bottom:4px">${CLUSTER_NAMES[d.cluster]}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px 10px;font-size:0.78rem">
      <span style="opacity:0.65">Speed</span><span>${d.speed_mean.toFixed(2)}</span>
      <span style="opacity:0.65">Efficiency</span><span>${d.path_efficiency.toFixed(2)}</span>
      <span style="opacity:0.65">Pause rate</span><span>${d.pause_rate.toFixed(2)}</span>
      <span style="opacity:0.65">Duration</span><span>${d.duration.toFixed(2)}</span>
      <span style="opacity:0.65">Anomaly</span><span>${d.anomaly_score.toFixed(2)}</span>
    </div>
  `;
}

function buildStatsCardHTML(d) {
  const clr = colorMap[d.cluster] || "#888";
  const gameLabel = GAME_FILTERS.find(f => f.game_type === d.game_type)?.label || d.game_type;
  const stats = [
    { label: "Speed",      value: d.speed_mean.toFixed(2),      unit: "px/tick" },
    { label: "Efficiency", value: d.path_efficiency.toFixed(2), unit: "" },
    { label: "Pause rate", value: d.pause_rate.toFixed(2),      unit: "" },
    { label: "Duration",   value: d.duration.toFixed(2),        unit: "log-ms" },
    { label: "Anomaly",    value: d.anomaly_score.toFixed(2),   unit: "" },
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
  let ttTimer;

  circles
    .on("mouseover", function (event, d) {
      if (+d3.select(this).style("opacity") < 0.05) return;
      if (ttTimer) clearTimeout(ttTimer);
      state.hoveredPoint = d;
      tooltip.html(buildTooltipHTML(d)).style("opacity", 1);
      showHoverRadar(d);
    })
    .on("mousemove", event => {
      tooltip.style("left", (event.pageX + 10) + "px").style("top", (event.pageY - 20) + "px");
    })
    .on("mouseout", () => {
      state.hoveredPoint = null;
      ttTimer = setTimeout(() => {
        tooltip.style("opacity", 0);
        hideHoverRadar();
      }, 50);
    })
    .on("click", function (event, d) {
      event.stopPropagation();
      const id = d.hf_index;
      if (state.selectedPoint === id) {
        state.selectedPoint = null;
        d3.select("#selected-point-info").html("").style("display", "none");
        d3.select("#trajectory-plot").html("");
        d3.select("#trajectory-caption").html("");
      } else {
        state.selectedPoint = id;
        d3.select("#selected-point-info")
          .html(buildStatsCardHTML(d))
          .classed("tooltip-style", false)
          .style("display", "block");

        const gameId = GAME_TYPE_TO_ID[d.game_type] || null;
        if (gameId && state.selectedGame !== gameId) {
          state.selectedGame = gameId;
          updateFilterAppearance();
          applyFilter();
        }

        renderMouseTrajectory(id, "trajectory-plot", "#trajectory-caption", points);
      }
      updateVisuals();
    });
}

function updateLegendAppearance() {
  svg.selectAll(".legend-item").each(function (d) {
    const g = d3.select(this);
    const isHovered  = state.hoveredCluster === d.id;
    const isSelected = state.selectedClusters.has(d.id);
    g.select("text")
      .classed("hovered",  isHovered)
      .classed("selected", isSelected);
    g.select("rect")
      .attr("stroke-width", isSelected ? 2 : 1);
  });
}

function scatterApplyFilter(activeClusters, activeGameTypes) {
  const allCircles = svg.selectAll(".point-circle");
  if (state.selectedPoint !== null) {
    allCircles.filter(d => d.hf_index === state.selectedPoint).raise();
  }
  allCircles
    .attr("r",            d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_R * _dpr : 1.5 * _dpr)
    .attr("stroke",       d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE : "none")
    .attr("stroke-width", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE_W * _dpr : 0)
    .transition().duration(TRANSITION_MS).ease(TRANSITION_EASE)
    .attr("opacity", d => {
      if (d.hf_index === state.selectedPoint) { committedOpacity.set(d.hf_index, 1); return 1; }
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
    .attr("r",            d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_R * _dpr : 1.5 * _dpr)
    .attr("stroke",       d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE : "none")
    .attr("stroke-width", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE_W * _dpr : 0)
    .transition().duration(HOVER_OUT_MS).ease(TRANSITION_EASE)
    .attr("opacity", d => committedOpacity.get(d.hf_index) ?? SCATTER_UNSELECTED_OPACITY);
}
