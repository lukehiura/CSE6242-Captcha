// backend url - change if needed
const API_BASE = "http://127.0.0.1:5001";

Promise.all([
  d3.json(`${API_BASE}/api/scatter_points.json`),
  d3.json(`${API_BASE}/api/cluster_meta.json`),
]).then(([points, clusters]) => {

  console.log("Loaded points:", points.length, "clusters:", clusters.length);

  // ---------------- FEATURES ----------------
  const features = ["speed_mean", "path_efficiency", "pause_rate", "duration"];

  // ---------------- STATE ----------------
  let state = {
    selectedClusters: new Set(), // can hold multiple clusters
    selectedGames: new Set(),    // can hold multiple games
    hoveredCluster: null,
    hoveredGame: null,
    hoveredPoint: null,
    clusterCentroids: computeClusterCentroids(points),
    selectedPoint: null
  };

  function resetAll() {
    state.selectedClusters.clear();
    state.selectedGames.clear();
    state.hoveredCluster = null;
    state.hoveredGame = null;
    state.hoveredPoint = null;
    state.selectedPoint = null;

    // Clear info panel AND hide it
    d3.select("#selected-point-info")
      .html("")             // remove content
      .style("display", "none") // hide so background disappears
      .classed("tooltip-style", false); // remove background class

    // Clear trajectory
    d3.select("#trajectory-plot").html("");
    d3.select("#trajectory-caption").html("");

    applyFilter();
    updateLegendAppearance();
    updateFilterAppearance();
    updateVisuals();
  }

  // ---------------- OPACITY, FADE, & TRANSITION CONSTANTS ----------------

  // Scatter plot opacity
  const SCATTER_PREVIEW_OPACITY = 0.15;    // dimmed preview while hovering a filter
  const SCATTER_SELECTED_OPACITY = 0.5;
  const SCATTER_UNSELECTED_OPACITY = 0.04; // nearly invisible when filtered out

  // Radar centroid polygon stroke
  const RADAR_STROKE_WIDTH = 1.2;          // thinner outlines
  const RADAR_STROKE_OPACITY = 0.7;        // overall centroid path opacity

  // Radar hover fill (point hover polygon)
  const RADAR_HOVER_FILL_OPACITY = 0.15;
  const RADAR_HOVER_STROKE_WIDTH = 1.5;

  // Radar filter-preview opacity (centroid paths dimmed for non-matching clusters)
  const RADAR_PREVIEW_OPACITY = 0.15;

  // Scatter selected-point highlight
  const SCATTER_SELECTED_STROKE = "#111";
  const SCATTER_SELECTED_STROKE_WIDTH = 2;
  const SCATTER_SELECTED_R = 1.5;            // slightly larger when selected

  // Core UI transitions (filters, hover, selection updates)
  const TRANSITION_DURATION = 350;
  const TRANSITION_EASING = d3.easeCubicOut;

  // Hover micro-transitions
  const HOVER_IN_DURATION = 80;
  const HOVER_OUT_DURATION = 220;

  // Trajectory + selection fade timing (synced)
  const FADE_DURATION = 1500;

  // Delay before fade starts after animation completes
  const FADE_DELAY = 5000;

  // Optional: easing for smoother animations (recommended)
  const EASING = d3.easeCubicOut;

  // ---------------- OPACITY CACHE ----------------
  // Tracks the committed opacity of every point after applyFilter.
  // updatePreview reads this to ensure preview never raises a point above its current level.
  const committedOpacity = new Map(); // hf_index → current committed opacity
  points = points.filter(d => !d.is_outlier);
  points.forEach(d => d.duration = Math.log(d.duration));
  let currentPoints = points.slice();
  console.log("After outlier removal and duration log:", currentPoints.length);

  const clusterNames = {
    0: "Fast-Balanced-Fluid",
    1: "Slow-Balanced-Fluid",
    2: "Moderate-Circuitous-Hesitant",
    3: "Moderate-Direct-Fluid"
  };

  const colorPalette = ["#4daf4a", "#377eb8", "#ff7f00", "#e41a1c"];
  const colorMap = {};
  clusters.forEach((c, i) => colorMap[c.id] = colorPalette[i]);

  // ---------------- FEATURE NORMALIZATION ----------------
  const featureScales = {};
  features.forEach(f => {
    const ext = d3.extent(currentPoints, d => d[f]);
    featureScales[f] = d3.scaleLinear().domain(ext).range([0, 1]);
  });

  // ---------------- PCA SCALES & AXES ----------------
  const container = document.getElementById("scatter-plot");
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  // Square plot based on smaller dimension
  const plotSize = Math.min(containerWidth, containerHeight);

  const margin = { top: 50, right: 50, bottom: 50, left: 50 };
  const width = plotSize - margin.left - margin.right;
  const height = plotSize - margin.top - margin.bottom;

  // Compute extents for both axes
  const xExtent = d3.extent(currentPoints, d => d.pca_x);
  const yExtent = d3.extent(currentPoints, d => d.pca_y);

  // Create scales (square, so same min/max)
  const minExtent = Math.min(xExtent[0], yExtent[0]);
  const maxExtent = Math.max(xExtent[1], yExtent[1]);

  const x = d3.scaleLinear()
    .domain([minExtent, maxExtent])
    .range([margin.left, margin.left + width]);

  const y = d3.scaleLinear()
    .domain([minExtent, maxExtent])
    .range([margin.top + height, margin.top]); // SVG y=0 is top

  // Create SVG
  const svg = d3.select("#scatter-plot")
    .append("svg")
    .attr("viewBox", `0 0 ${plotSize} ${plotSize}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "100%");

  // ---------------- AXES ----------------
  // Compute origin in pixels
  const x0 = x(0); // x position of 0
  const y0 = y(0); // y position of 0
  const axisLabelOffset = 12;

  // X axis at origin
  svg.append("g")
    .attr("transform", `translate(0,${y0})`)
    .call(d3.axisBottom(x).ticks(6));

  // Y axis at origin
  svg.append("g")
    .attr("transform", `translate(${x0},0)`)
    .call(d3.axisLeft(y).ticks(6));

  // Axis labels
  svg.append("text")
    .attr("x", x0)
    .attr("y", margin.top - axisLabelOffset)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("font-weight", "semi bold")
    .text("PC1");

  svg.append("text")
    .attr("x", margin.left + width + axisLabelOffset)
    .attr("y", y0 + 1.5)
    .attr("text-anchor", "start")
    .attr("dominant-baseline", "middle")
    .style("font-size", "14px")
    .style("font-weight", "semi bold")
    .text("PC2");

  // ---------------- SCATTER POINTS ----------------
  let circles = svg.selectAll(".point-circle")
    .data(points, d => d.id)
    .enter()
    .append("circle")
    .attr("class", "point-circle")
    .attr("cx", d => x(d.pca_x))
    .attr("cy", d => y(d.pca_y))
    .attr("r", 1.5)
    .attr("fill", d => colorMap[d.cluster])
    .attr("opacity", SCATTER_SELECTED_OPACITY)
    .style("cursor", "pointer");

  attachCircleHover(circles);


  // ---------------- TOOLTIP ----------------
  const tooltip = d3.select("body").append("div")
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
    .style("display", "inline-block")
    .style("white-space", "normal")
    .style("max-width", "250px");


  function buildTooltipHTML(d) {
    return `
    <b>Index:</b> ${d.hf_index}<br/>
    <b>${clusterNames[d.cluster]} (${d.cluster})</b><br/>
    <b>Game type:</b> ${d.game_type}<br/>
    <b>Speed mean:</b> ${d.speed_mean.toFixed(2)}<br/>
    <b>Path efficiency:</b> ${d.path_efficiency.toFixed(2)}<br/>
    <b>Pause rate:</b> ${d.pause_rate.toFixed(2)}<br/>
    <b>Duration:</b> ${d.duration.toFixed(2)}<br/>
    <b>Anomaly score:</b> ${d.anomaly_score.toFixed(2)}
  `;
  }


  // -------------------- SHOW POINT INFO --------------------
  function showPointInfo(point) {
    const infoDiv = d3.select("#selected-point-info");
    const infoWidth = document.getElementById("selected-point-info-wrapper").clientWidth;
    const infoHeight = document.getElementById("selected-point-info-wrapper").clientHeight;
    const infoMargin = { top: 10, right: 10, bottom: 10, left: 10 };
    const lineSpacing = 18;

    // Clear previous content
    infoDiv.html("").style("display", "block");

    // Logical SVG size (like PCA scatter & radar)
    const viewWidth = infoWidth - infoMargin.left - infoMargin.right;
    const viewHeight = infoHeight - infoMargin.top - infoMargin.bottom;

    // Append SVG with responsive scaling
    const svgInfo = infoDiv.append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${viewWidth} ${viewHeight}`)
      .attr("preserveAspectRatio", "xMidYMid meet"); // scales content

    // Optional background rectangle
    svgInfo.append("rect")
      .attr("x", 0).attr("y", 0)
      .attr("width", viewWidth)
      .attr("height", viewHeight)
      .attr("fill", "#f9f9f9")
      .attr("stroke", "#ccc")
      .attr("rx", 4)
      .attr("ry", 4);


    const g = svgInfo.append("g")
      .attr("transform", `translate(${infoMargin.left}, ${infoMargin.top})`);

    // Text lines to display
    const infoLines = [
      `Index: ${point.hf_index}`,
      `${clusterNames[point.cluster]} (${point.cluster})`,
      `Game type: ${point.game_type}`,
      `Speed mean: ${point.speed_mean.toFixed(2)}`,
      `Path efficiency: ${point.path_efficiency.toFixed(2)}`,
      `Pause rate: ${point.pause_rate.toFixed(2)}`,
      `Duration: ${point.duration.toFixed(2)}`,
      `Anomaly score: ${point.anomaly_score.toFixed(2)}`
    ];

    // Append text elements
    g.selectAll("text")
      .data(infoLines)
      .enter()
      .append("text")
      .attr("x", 0)
      .attr("y", (_, i) => i * lineSpacing)
      .text(d => d)
      .attr("fill", "#ffffff")
      .attr("dominant-baseline", "hanging");
  }

  d3.selectAll(".data-point")
    .on("click", function (event, d) {
      showPointInfo(d);
    });

  // ======================== RADAR SETUP ========================
  const radarContainer = d3.select("#radar");
  const wrapperWidth = radarContainer.node().clientWidth;
  const wrapperHeight = radarContainer.node().clientHeight;

  // Margins and dimensions
  const radarMargin = { top: 20, right: 45, bottom: 70, left: 45 };
  const innerWidth = wrapperWidth - radarMargin.left - radarMargin.right;
  const innerHeight = wrapperHeight - radarMargin.top - radarMargin.bottom;
  const radarSize = Math.min(innerWidth, innerHeight);
  const radarRadius = radarSize / 2;
  const offsetX = radarMargin.left + (innerWidth - radarSize) / 2;
  const offsetY = radarMargin.top + (innerHeight - radarSize) / 2;

  // SVG setup
  const radarSvgRoot = radarContainer.append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${wrapperWidth} ${wrapperHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const radarSvg = radarSvgRoot.append("g")
    .attr("transform", `translate(${offsetX + radarRadius},${offsetY + radarRadius})`);

  // Radar parameters
  const angleSlice = 2 * Math.PI / features.length;
  const ringCount = 4;

  // ======================== RADAR LEGEND / BOTTOM TEXT ========================
  const radarLegend = radarSvgRoot.append("g")
    .attr("transform", `translate(${wrapperWidth / 2}, ${wrapperHeight - radarMargin.bottom / 3})`);

  // Line 1
  radarLegend.append("text")
    .attr("text-anchor", "middle")
    .attr("class", "filters-text")
    .html(`<tspan font-weight="bold">Solid outline</tspan>: cluster centroid averages`);

  // Line 2 with highlighted rectangle
  const line2Group = radarLegend.append("g").attr("transform", "translate(0, 16)");

  // Hidden text for measurement
  const fullText = line2Group.append("text")
    .attr("class", "filters-text")
    .attr("text-anchor", "middle")
    .attr("visibility", "hidden");
  fullText.append("tspan").text("Filled polygon");
  fullText.append("tspan").text(": selected point behavior");

  const fullBBox = fullText.node().getBBox();

  // Temp text for measuring just "Filled polygon"
  const line2tempText = line2Group.append("text")
    .attr("class", "filters-text")
    .attr("text-anchor", "start")
    .text("Filled polygon");
  const bbox = line2tempText.node().getBBox();

  // Draw background rectangle behind text
  line2Group.insert("rect", "text")
    .attr("x", -fullBBox.width / 2 - 2)
    .attr("y", bbox.y - 1)
    .attr("width", bbox.width + 4)
    .attr("height", bbox.height + 2)
    .attr("fill", "#ddd")
    .attr("rx", 2);

  // Reveal final text and remove temp
  fullText.attr("visibility", "visible");
  line2tempText.remove();

  // ======================== RADAR GRID ========================
  for (let i = 1; i <= ringCount; i++) {
    radarSvg.append("circle")
      .attr("r", radarRadius * (i / ringCount))
      .attr("fill", "none")
      .attr("stroke", "#ccc")
      .attr("stroke-dasharray", "2,2");
  }

  // Feature axes and labels
  features.forEach((f, i) => {
    const angle = i * angleSlice - Math.PI / 2;
    // Axis line
    radarSvg.append("line")
      .attr("x1", 0).attr("y1", 0)
      .attr("x2", Math.cos(angle) * radarRadius)
      .attr("y2", Math.sin(angle) * radarRadius)
      .attr("stroke", "#999");
    // Axis label
    radarSvg.append("text")
      .attr("x", Math.cos(angle) * (radarRadius + 12))
      .attr("y", Math.sin(angle) * (radarRadius + 12))
      .attr("text-anchor", "middle")
      .attr("alignment-baseline", "middle")
      .attr("class", "filters-text")
      .text(f);
  });

  // ======================== RADAR LINE FUNCTION ========================
  function radarLine(values) {
    const scaled = values.map((v, i) => featureScales[features[i]](v));
    const closed = [...scaled, scaled[0]];
    return d3.lineRadial()
      .radius(v => v * radarRadius)
      .angle((_, i) => i * angleSlice)(closed);
  }

  // ======================== CLUSTER CENTROIDS ========================
  console.log("clusterCentroids for radar:", state.clusterCentroids);
  state.clusterCentroids = computeClusterCentroids(currentPoints);
  console.log("state.clusterCentroids:", state.clusterCentroids);

  // Optional debug: log each feature for first cluster
  state.clusterCentroids.forEach(c => {
    features.forEach(f => console.log(`Cluster ${c.cluster}, feature ${f}:`, c[f]));
  });

  // Draw centroid paths
  let centroidPaths = radarSvg.selectAll(".centroid-radar")
    .data(state.clusterCentroids, d => d.cluster)
    .join(
      enter => enter.append("path")
        .attr("class", "centroid-radar")
        .attr("fill", "none")
        .attr("stroke", d => colorMap[d.cluster])
        .attr("stroke-width", RADAR_STROKE_WIDTH)
        .attr("opacity", RADAR_STROKE_OPACITY)
        .attr("d", d => radarLine(features.map(f => d[f]))),
      update => update
        .attr("d", d => radarLine(features.map(f => d[f])))
        .attr("stroke", d => colorMap[d.cluster])
        .attr("stroke-width", RADAR_STROKE_WIDTH)
        .attr("opacity", RADAR_STROKE_OPACITY),
      exit => exit.remove()
    );

  // ======================== HOVER PREVIEW PATH ========================
  let hoveredRadarPath = radarSvg.append("path")
    .attr("class", "point-radar")
    .attr("fill", "none")
    .attr("stroke-width", RADAR_HOVER_STROKE_WIDTH)
    .attr("pointer-events", "none")
    .style("opacity", 0); // initially hidden

  // ======================== CLUSTER HIGHLIGHT FUNCTION ========================
  function highlightCluster(clusterId) {
    // fade all other points
    circles.attr("opacity", d => d.cluster === clusterId ? 1 : 0.1);
    centroidPaths.attr("opacity", d => d.cluster === clusterId ? 1 : 0.1);

    // find centroid
    const clusterData = state.clusterCentroids.find(c => c.cluster === clusterId);
    if (!clusterData) return;

    // remove previous highlight and add filled polygon
    radarSvg.selectAll(".point-radar").remove();
    radarSvg.append("path")
      .attr("class", "point-radar")
      .attr("d", radarLine(features.map(f => clusterData[f])))
      .attr("fill", colorMap[clusterId])
      .attr("stroke", colorMap[clusterId])
      .attr("opacity", 0.4);

    // Re-append the hover preview path so it's always on top
    hoveredRadarPath = radarSvg.append("path")
      .attr("class", "point-radar")
      .attr("fill", "none")
      .attr("stroke-width", RADAR_HOVER_STROKE_WIDTH)
      .attr("pointer-events", "none")
      .style("opacity", 0);

    // update legend
    svg.selectAll(".pca-legend .legend-item text")
      .style("font-weight", "normal")
      .style("fill", "#ffffff");

    svg.select(`.pca-legend .legend-item[data-cluster='${clusterId}'] text`)
      .style("font-weight", "bold")
      .style("fill", colorMap[clusterId]);
  }

  // ======================== ATTACH CIRCLE HOVER ========================
  function attachCircleHover(circles) {
    let tooltipTimeout;

    circles.on("mouseover", function (event, d) {
      if (+d3.select(this).style("opacity") < 0.05) return; // skip invisible

      if (tooltipTimeout) clearTimeout(tooltipTimeout);
      state.hoveredPoint = d;

      // Tooltip
      tooltip.html(buildTooltipHTML(d)).style("opacity", 1);

      // Radar polygon hover
      hoveredRadarPath.transition().duration(HOVER_IN_DURATION)
        .attr("d", radarLine(features.map(f => d[f])))
        .attr("stroke", colorMap[d.cluster])
        .attr("fill", colorMap[d.cluster])
        .attr("fill-opacity", RADAR_HOVER_FILL_OPACITY)
        .style("opacity", 1);
    })
      .on("mousemove", event => {
        tooltip.style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 20) + "px");
      })
      .on("mouseout", () => {
        state.hoveredPoint = null;
        tooltipTimeout = setTimeout(() => {
          tooltip.style("opacity", 0);
          hoveredRadarPath.transition().duration(HOVER_OUT_DURATION).style("opacity", 0);
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
            .html(buildTooltipHTML(d))
            .classed("tooltip-style", true);
          renderMouseTrajectory(id, "trajectory-plot", "#trajectory-caption", points);
        }

        updateVisuals();
      });
  }

  // ---------------- LEGEND ----------------
  const legendSpacing = 18;
  const squareSize = 12;
  const textGap = 6;

  const pcaLegendGroup = svg.append("g")
    .attr("class", "pca-legend")
    .attr("transform", `translate(${margin.left}, ${margin.top + height - clusters.length * legendSpacing})`);

  const legendItems = pcaLegendGroup.selectAll(".legend-item")
    .data(clusters)
    .join("g")
    .attr("class", "legend-item")
    .attr("data-cluster", d => d.id)
    .attr("transform", (d, i) => `translate(0, ${i * legendSpacing})`)
    .style("cursor", "pointer")
    .on("mouseover", (event, d) => {
      state.hoveredCluster = d.id;
      updateLegendAppearance();
      updatePreview();   // dim non-matching scatter + radar as preview
    })
    .on("mouseout", () => {
      state.hoveredCluster = null;
      updateLegendAppearance();
      updateVisuals();   // restore normal state
    })
    .on("click", (event, d) => {
      if (state.selectedClusters.has(d.id)) {
        state.selectedClusters.delete(d.id);
      } else {
        state.selectedClusters.add(d.id);
      }

      if (state.selectedClusters.size === clusters.length) {
        state.selectedClusters.clear();
      }

      updateLegendAppearance();
      applyFilter();
    });

  // draw rectangles
  legendItems.append("rect")
    .attr("width", squareSize)
    .attr("height", squareSize)
    .attr("fill", d => colorMap[d.id] || "#888")
    .attr("stroke", "#333")
    .attr("stroke-width", 1);

  // draw text
  legendItems.append("text")
    .text(d => clusterNames[d.id])
    .attr("x", squareSize + textGap)
    .attr("y", squareSize / 2)
    .attr("dominant-baseline", "middle")
    .attr("class", "filters-text");

  // update styles
  function updateLegendAppearance() {
    svg.selectAll(".legend-item").each(function (d) {
      const g = d3.select(this);
      const clusterId = d.id;

      g.select("rect")
      g.select(".icon-wrapper svg")
        .style("stroke",
          isSelected ? "#FFFFFF" :
            isHovered ? "#E6E6E6" :
              "#CCCCCC"
        )
        .attr("stroke-width", state.selectedClusters.has(clusterId) ? 2 : 1);

      g.select("text")
        .classed("hovered", state.hoveredCluster === clusterId)
        .classed("selected", state.selectedClusters.has(clusterId));
    });
  }

  // ---------------- GAME FILTERS ----------------
  const filterDiv = document.getElementById("filter-container");
  const fWidth = filterDiv.clientWidth;
  const fHeight = filterDiv.clientHeight;
  const fMargin = { top: 5, right: 5, bottom: 5, left: 5 };
  const innerW = fWidth - fMargin.left - fMargin.right;
  const innerH = fHeight - fMargin.top - fMargin.bottom;
  const centerX = fMargin.left + innerW / 2;
  const circleRadius = Math.min(innerW / 2, innerH / 2 / 3) * 0.6

  const gameFilters = [
    { id: "sheep", label: "Sheep Herding", svgPath: svgIcons.sheep, game_type: "sheep-herding" },
    { id: "thread", label: "Thread the Needle", svgPath: svgIcons.thread, game_type: "thread-the-needle" },
    { id: "polygon", label: "Polygon Stacking", svgPath: svgIcons.polygon, game_type: "polygon-stacking" }
  ];

  const gameIdToType = {};
  const gameTypeToId = {};

  gameFilters.forEach(f => {
    gameIdToType[f.id] = f.game_type;
    gameTypeToId[f.game_type] = f.id;
  });


  // ---------------- GAME FILTERS OPTIMIZED ----------------
  const filterSvg = d3.select("#filter-container")
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${fWidth} ${fHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  // ---------------- GAME FILTERS ----------------
  const filterItems = filterSvg.selectAll(".filter-item")
    .data(gameFilters, d => d.id)
    .join("g")
    .attr("class", "filter-item")
    .attr("transform", (d, i) => {
      const y = fMargin.top + circleRadius + i * (circleRadius * 3.3);
      return `translate(${centerX}, ${y})`;
    });

  // --- Circle background ---
  filterItems.append("circle")
    .attr("r", circleRadius)
    .attr("fill", "#999999")
    .attr("stroke", "#CCCCCC")
    .attr("stroke-width", 2);

  // --- Icon ---
  filterItems.append("g")
    .attr("class", "icon-wrapper")
    .each(function (d) {
      const g = d3.select(this);
      g.html(svgIcons[d.id]);
      const bbox = g.node().getBBox();
      const scale = (circleRadius * 1.4) / Math.max(bbox.width, bbox.height);
      g.attr("transform", `translate(${-bbox.x * scale - bbox.width * scale / 2},${-bbox.y * scale - bbox.height * scale / 2}) scale(${scale})`);
    });

  // --- Text label ---
  filterItems.append("text")
    .attr("class", "filters-text")
    .attr("x", 0)
    .attr("y", circleRadius * 1.2)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "hanging")
    .text(d => d.label);

  filterItems
    .style("cursor", "pointer")
    .on("mouseover", (event, d) => {
      state.hoveredGame = d.id;
      updateFilterAppearance();
      updatePreview();   // dim non-matching scatter + radar as preview
    })
    .on("mouseout", () => {
      state.hoveredGame = null;
      updateFilterAppearance();
      updateVisuals();   // restore normal state
    })
    .on("click", (event, d) => {
      // toggle selection in games set
      if (state.selectedGames.has(d.id)) {
        state.selectedGames.delete(d.id);
      } else {
        state.selectedGames.add(d.id);
      }

      // if all games selected, clear to show all
      if (state.selectedGames.size === gameFilters.length) {
        state.selectedGames.clear();
      }

      updateFilterAppearance();
      applyFilter();
    });


  function updateFilterAppearance() {
    filterItems.each(function (d) {
      const g = d3.select(this);
      const isHovered = state.hoveredGame === d.id;
      const isSelected = state.selectedGames.has(d.id);

      // --- Circle ---
      g.select("circle")
        .attr("stroke",
          isSelected ? "#FFFFFF" :
            isHovered ? "#E6E6E6" :
              "#CCCCCC"
        )
        .attr("stroke",
          isSelected ? "#FFFFFF" :
            isHovered ? "#BFBFBF" :
              "#999999"
        )
        .attr("stroke-width", isHovered || isSelected ? 3 : 2);

      // --- Text ---
      g.select("text")
        .classed("hovered", isHovered)
        .classed("selected", isSelected);

      // --- Icon ---
      g.select(".icon-wrapper svg")
        .style("fill",
          isSelected ? "#FFFFFF" :
            isHovered ? "#E6E6E6" :
              "#CCCCCC"
        )
        .style("opacity", isHovered || isSelected ? 1 : 0.65);

    });
  }


  // ---------------- COMPUTE CLUSTER CENTROIDS ----------------
  function computeClusterCentroids(points) {
    const clusters = d3.group(points, d => d.cluster);
    const centroids = [];

    clusters.forEach((pts, clusterId) => {
      const centroid = {
        cluster: clusterId,
        duration: d3.mean(pts, d => d.duration),
        speed_mean: d3.mean(pts, d => d.speed_mean),
        path_efficiency: d3.mean(pts, d => d.path_efficiency),
        pause_rate: d3.mean(pts, d => d.pause_rate)
      };

      // create values array for radar — must match features order: ["speed_mean", "path_efficiency", "pause_rate", "duration"]
      centroid.values = features.map(f => centroid[f]);

      centroids.push(centroid);
    });

    return centroids;
  }


  // ---------------- UPDATE RADAR CHART ----------------
  function updateRadarChart(clusterCentroids) {
    const joined = radarSvg.selectAll(".centroid-radar")
      .data(clusterCentroids, d => d.cluster);

    joined.enter()
      .append("path")
      .attr("class", "centroid-radar")
      .attr("fill", "none")
      .attr("stroke", d => colorMap[d.cluster])
      .attr("stroke-width", RADAR_STROKE_WIDTH)
      .attr("d", d => radarLine(features.map(f => d[f])))
      .attr("opacity", 0)
      .transition().duration(TRANSITION_DURATION).ease(TRANSITION_EASING)
      .attr("opacity", RADAR_STROKE_OPACITY);

    joined
      .attr("stroke", d => colorMap[d.cluster])
      .attr("stroke-width", RADAR_STROKE_WIDTH)
      .transition().duration(TRANSITION_DURATION).ease(TRANSITION_EASING)
      .attr("d", d => radarLine(features.map(f => d[f])))
      .attr("opacity", RADAR_STROKE_OPACITY);

    joined.exit()
      .transition().duration(TRANSITION_DURATION).ease(TRANSITION_EASING)
      .attr("opacity", 0)
      .remove();

    // Keep centroidPaths in sync as a live selection (enter + update, no exit)
    centroidPaths = radarSvg.selectAll(".centroid-radar");
  }


  // ---------------- PRECOMPUTE RADAR CENTROIDS BY GAME COMBINATION ----------------

  // 1. List all game types
  const allGameTypes = Array.from(new Set(points.map(d => d.game_type)));

  // 2. Generate all non-empty combinations of game types
  function getAllCombinations(array) {
    const results = [];
    const n = array.length;
    for (let i = 1; i < 1 << n; i++) {
      const combo = [];
      for (let j = 0; j < n; j++) {
        if (i & (1 << j)) combo.push(array[j]);
      }
      results.push(combo);
    }
    return results;
  }

  const gameCombinations = getAllCombinations(allGameTypes);

  // 3. Precompute centroids for each combination
  const precomputedCentroids = new Map(); // key = JSON string of sorted game types
  gameCombinations.forEach(combo => {
    const comboPoints = points.filter(d => combo.includes(d.game_type));
    const centroids = computeClusterCentroids(comboPoints);
    const key = JSON.stringify(combo.slice().sort());
    precomputedCentroids.set(key, centroids);
  });

  // ---------------- HELPER: get precomputed centroids ----------------
  function getCentroidsForSelectedGames(selectedGames) {
    if (!selectedGames || selectedGames.size === 0) {
      // no game filter → use precomputed all-games centroids
      const allKey = JSON.stringify(allGameTypes.slice().sort());
      return precomputedCentroids.get(allKey) || computeClusterCentroids(points);
    }
    const gameTypes = Array.from(selectedGames).map(id => gameIdToType[id]).filter(Boolean);
    const key = JSON.stringify(gameTypes.sort());
    return precomputedCentroids.get(key) || [];
  }

  // ---------------- APPLY FILTER ----------------
  function applyFilter() {
    const activeClusters = new Set([...state.selectedClusters]);
    const activeGameTypes = new Set([...state.selectedGames].map(id => gameIdToType[id]));

    // ---------------- UPDATE RADAR CHART ----------------
    const centroids = getCentroidsForSelectedGames(state.selectedGames);
    state.clusterCentroids = centroids.filter(c =>
      activeClusters.size === 0 || activeClusters.has(c.cluster)
    );
    updateRadarChart(state.clusterCentroids);
    console.log("Radar centroids:", state.clusterCentroids);

    // ---------------- UPDATE SCATTER POINTS ----------------
    // Never remove circles from DOM — only adjust opacity so preview hover always works.
    const allCircles = svg.selectAll(".point-circle");

    if (state.selectedPoint !== null) {
      allCircles.filter(d => d.hf_index === state.selectedPoint).raise();
    }

    allCircles
      .attr("r", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_R : 1.5)
      .attr("fill", d => colorMap[d.cluster])
      .attr("stroke", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE : "none")
      .attr("stroke-width", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE_WIDTH : 0)
      .attr("stroke-opcacity", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE_WIDTH : 0)
      .transition().duration(TRANSITION_DURATION).ease(TRANSITION_EASING)
      .attr("opacity", d => {
        if (d.hf_index === state.selectedPoint) {
          committedOpacity.set(d.hf_index, 1);
          return 1;
        }
        const clusterMatch = activeClusters.size === 0 || activeClusters.has(d.cluster);
        const gameMatch = activeGameTypes.size === 0 || activeGameTypes.has(d.game_type);
        const op = (clusterMatch && gameMatch) ? SCATTER_SELECTED_OPACITY : SCATTER_UNSELECTED_OPACITY;
        committedOpacity.set(d.hf_index, op);
        return op;
      });
  }

  console.log(precomputedCentroids.keys()); // should show all non-empty game combos
  console.log(precomputedCentroids.get(JSON.stringify(["sheep-herding", "thread-the-needle"].sort())));

  // ---------------- UPDATE PREVIEW (hover only — no state change) ----------------
  // Rule: a point's opacity can only go DOWN or stay the same during a preview.
  // Points not in the current filter stay invisible. Points that WOULD leave on click dim.
  // Points that would stay keep their current opacity. Uses committedOpacity cache — O(1) per point.
  function updatePreview() {
    const previewCluster = state.hoveredCluster;
    const previewGame = state.hoveredGame;

    // Effective filter if user clicked right now
    const effectiveClusters = previewCluster != null
      ? new Set([...state.selectedClusters, previewCluster])
      : state.selectedClusters;

    const effectiveGames = previewGame != null
      ? new Set([...state.selectedGames, previewGame])
      : state.selectedGames;

    svg.selectAll(".point-circle")
      .transition().duration(HOVER_IN_DURATION)
      .attr("opacity", d => {
        if (d.hf_index === state.selectedPoint) return 1;
        const current = committedOpacity.get(d.hf_index) ?? SCATTER_UNSELECTED_OPACITY;
        const clusterMatch = effectiveClusters.size === 0 || effectiveClusters.has(d.cluster);
        const gameMatch = effectiveGames.size === 0 || effectiveGames.has(gameTypeToId[d.game_type]);
        const wouldBeActive = clusterMatch && gameMatch;
        if (wouldBeActive) {
          // will be active after click — show at full opacity (may go up from unselected)
          return SCATTER_SELECTED_OPACITY;
        } else {
          // will not be active — can only dim, never raise
          return Math.min(current, SCATTER_PREVIEW_OPACITY);
        }
      });

    // Radar: dim centroid outlines that won't survive the click
    radarSvg.selectAll(".centroid-radar")
      .transition().duration(HOVER_IN_DURATION)
      .attr("opacity", d => {
        const clusterMatch = effectiveClusters.size === 0 || effectiveClusters.has(d.cluster);
        return clusterMatch ? RADAR_STROKE_OPACITY : RADAR_PREVIEW_OPACITY;
      });
  }

  // ---------------- UPDATE VISUALS ----------------
  // Restores scatter and radar to the committed filter state (undoes any preview dimming).
  function updateVisuals() {
    // Radar: recompute and animate to committed centroid set
    const centroids = getCentroidsForSelectedGames(state.selectedGames)
      .filter(c => state.selectedClusters.size === 0 || state.selectedClusters.has(c.cluster));
    updateRadarChart(centroids);

    // Scatter: re-query DOM, raise selected, restore from cache
    const allCircles = svg.selectAll(".point-circle");

    if (state.selectedPoint !== null) {
      allCircles.filter(d => d.hf_index === state.selectedPoint).raise();
    }

    allCircles
      .attr("r", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_R : 1.5)
      .attr("stroke", d => d.hf_index === state.selectedPoint ? SCATTER_SELECTED_STROKE : "none")
      .attr("stroke-width", d => d.hf_index === state.selectedPoint ? 1 : SCATTER_SELECTED_OPACITY)
      .transition().duration(HOVER_OUT_DURATION).ease(TRANSITION_EASING)
      .attr("opacity", d => committedOpacity.get(d.hf_index) ?? SCATTER_UNSELECTED_OPACITY);
  }

  // ---------------- MOUSE TRAJECTORY FUNCTION ----------------
  function renderMouseTrajectory(hfIndex, targetDivId, captionSelector, scatterPoints) {
    d3.json(`${API_BASE}/session/${hfIndex}`).then(session => {
      const tickInputs = session.ticks || [];
      const gameType = session.game_type;

      const trajDiv = document.getElementById(targetDivId);
      if (!trajDiv) return console.warn(`Div ${targetDivId} not found`);
      trajDiv.innerHTML = "";

      const trajectoryCaption = d3.select(captionSelector);

      if (tickInputs.length === 0) {
        trajDiv.innerHTML = "<p>No tick data.</p>";
        trajectoryCaption.html(`<strong>Game:</strong> ${gameType} | <strong>Session:</strong> ${hfIndex} — no ticks`);
        return;
      }

      // ---- look up point data ----
      const pointData = scatterPoints.find(p => p.hf_index === hfIndex);
      const clusterId = pointData?.cluster ?? null;
      const clusterColor = clusterId != null ? (colorMap[clusterId] || "#888") : "#888";
      const clusterLabel = clusterId != null ? (clusterNames[clusterId] || `Cluster ${clusterId}`) : "Unknown";
      const gameId = gameTypeToId[gameType] || null;
      const gameLabel = gameFilters.find(f => f.id === gameId)?.label || gameType;

      // ---------------- CONFIG ----------------
      const CURSOR_UP_COLOR = "#bbb";
      const CURSOR_DOWN_COLOR = "#222";
      const MAX_TRAIL = 500;
      const CHAR_DELAY = 28 * 3;   // ms per character for typewriter
      const FADE_OUT_DURATION = 800;
      const FADE_OUT_DELAY = 7000;

      // ---------------- LAYOUT ----------------
      const totalW = trajDiv.clientWidth;
      const totalH = trajDiv.clientHeight;
      const padOuter = 20;

      // Square plot: fit in left half with equal margins
      const availH = totalH - padOuter * 2;
      const availW = totalW / 2 - padOuter * 2;
      const plotSize = Math.min(availW, availH);
      const plotX = padOuter + (availW - plotSize) / 2;  // center in left half
      const plotY = padOuter + (availH - plotSize) / 2;

      // Right panel starts at midpoint
      const rightX = totalW / 2 + padOuter;
      const rightW = totalW / 2 - padOuter * 2;

      // ---------------- SVG ----------------
      const tSvg = d3.select(`#${targetDivId}`)
        .append("svg")
        .attr("width", totalW)
        .attr("height", totalH)
        .attr("viewBox", `0 0 ${totalW} ${totalH}`)
        .attr("preserveAspectRatio", "xMinYMin meet");

      // ---- clip path for trajectory plot area ----
      const clipId = `traj-clip-${hfIndex}`;
      tSvg.append("defs").append("clipPath").attr("id", clipId)
        .append("rect")
        .attr("x", plotX).attr("y", plotY)
        .attr("width", plotSize).attr("height", plotSize);

      // ---- plot background ----
      tSvg.append("rect")
        .attr("x", plotX).attr("y", plotY)
        .attr("width", plotSize).attr("height", plotSize)
        .attr("fill", "#f9f9f9")
        .attr("stroke", "#ddd")
        .attr("stroke-width", 1)
        .attr("rx", 4);

      // ---------------- SCALES ----------------
      const xScale = d3.scaleLinear()
        .domain(d3.extent(tickInputs, d => d.x))
        .range([plotX + 6, plotX + plotSize - 6]);

      const yScale = d3.scaleLinear()
        .domain(d3.extent(tickInputs, d => d.y))
        .range([plotY + plotSize - 6, plotY + 6]);

      // ---- trail group (clipped) ----
      const trailGroup = tSvg.append("g").attr("clip-path", `url(#${clipId})`);

      // ---------------- CURSOR ----------------
      const cursor = tSvg.append("circle")
        .attr("r", 4)
        .attr("fill", CURSOR_UP_COLOR)
        .attr("opacity", 0.85)
        .attr("clip-path", `url(#${clipId})`);

      // ---- sample counter (bottom of plot) ----
      const sampleText = tSvg.append("text")
        .attr("x", plotX + plotSize / 2)
        .attr("y", plotY + plotSize + 14)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "hanging")
        .attr("class", "filters-text")
        .attr("opacity", 0);

      // ---- legend (bottom-left of plot) ----
      const legendY = plotY + plotSize + padOuter / 2;
      [[CURSOR_UP_COLOR, "Mouse up"], [CURSOR_DOWN_COLOR, "Mouse down"]].forEach(([color, label], li) => {
        tSvg.append("circle").attr("cx", plotX + li * 90).attr("cy", legendY + 1).attr("r", 4).attr("fill", color).attr("stroke", "#E6E6E6").attr("stroke-width", 0.5);
        tSvg.append("text").attr("x", plotX + li * 90 + 8).attr("y", legendY + 1).attr("dominant-baseline", "middle").attr("class", "filters-text").text(label);
      });

      // ==================== RIGHT PANEL ====================
      const iconRadius = Math.min(rightW * 0.18, 28);
      const iconCY = plotY + iconRadius + 4;
      const iconCX = rightX + iconRadius + 2;

      // ---- badge circle ----
      const badgeCircle = tSvg.append("circle")
        .attr("cx", iconCX).attr("cy", iconCY)
        .attr("r", iconRadius)
        .attr("fill", "#f0f0f0")
        .attr("stroke", "#999")
        .attr("stroke-width", 1.5);

      // ---- badge icon ----
      let iconPathGroup = null;
      if (gameId && svgIcons[gameId]) {
        const gIcon = tSvg.append("g").attr("class", "traj-icon");
        gIcon.html(svgIcons[gameId]);
        const bbox = gIcon.node().getBBox();
        const scale = (iconRadius * 1.3) / Math.max(bbox.width, bbox.height);
        gIcon.attr("transform",
          `translate(${iconCX - bbox.x * scale - (bbox.width * scale) / 2},` +
          `${iconCY - bbox.y * scale - (bbox.height * scale) / 2}) scale(${scale})`
        );
        iconPathGroup = gIcon;
      }

      // ---- game name next to badge ----
      tSvg.append("text")
        .attr("x", iconCX + iconRadius + 8)
        .attr("y", iconCY)
        .attr("dominant-baseline", "middle")
        .attr("class", "filters-text")
        .style("font-weight", "bold")
        .style("font-size", "11px")
        .text(gameLabel);

      // ---- index line ----
      tSvg.append("text")
        .attr("x", iconCX + iconRadius + 8)
        .attr("y", iconCY + 14)
        .attr("dominant-baseline", "middle")
        .attr("class", "filters-text")
        .style("font-size", "10px")
        .text(`#${hfIndex}`);

      // ---- typewriter lines ----
      const statsLines = [
        `Speed:       ${pointData?.speed_mean?.toFixed(2) ?? "—"}`,
        `Efficiency:  ${pointData?.path_efficiency?.toFixed(2) ?? "—"}`,
        `Pause rate:  ${pointData?.pause_rate?.toFixed(2) ?? "—"}`,
        `Duration:    ${pointData?.duration?.toFixed(2) ?? "—"}`,
        `Anomaly:     ${pointData?.anomaly_score?.toFixed(2) ?? "—"}`,
      ];

      const typeLineSpacing = 15;
      const typeStartY = iconCY + iconRadius + 18;
      const typeX = rightX + 4;

      // pre-append empty text nodes, one per line
      const typeNodes = statsLines.map((_, li) =>
        tSvg.append("text")
          .attr("x", typeX)
          .attr("y", typeStartY + li * typeLineSpacing)
          .attr("dominant-baseline", "hanging")
          .attr("class", "filters-text")
          .style("font-family", "monospace")
          .style("font-size", "10px")
          .text("")
      );

      // cluster reveal node (hidden until end)
      const clusterLabelY = typeStartY + statsLines.length * typeLineSpacing + 8;
      const clusterPrefix = "Behavior group: ";

      const clusterPrefixNode = tSvg.append("text")
        .attr("x", typeX)
        .attr("y", clusterLabelY)
        .attr("dominant-baseline", "hanging")
        .attr("class", "filters-text")
        .style("font-family", "monospace")
        .style("font-size", "10px")
        .attr("opacity", 0)
        .text("");

      const clusterNameNode = tSvg.append("text")
        .attr("x", typeX)   // will be repositioned after prefix is typed
        .attr("y", clusterLabelY)
        .attr("dominant-baseline", "hanging")
        .attr("class", "filters-text")
        .style("font-family", "monospace")
        .style("font-size", "10px")
        .style("font-weight", "bold")
        .style("fill", clusterColor)
        .attr("opacity", 0)
        .text("");

      // ---- typewriter engine ----
      // Chains all lines sequentially, then calls onDone when complete
      function typeLines(lines, nodes, charDelay, onDone) {
        let lineIdx = 0;
        function typeLine(li) {
          if (li >= lines.length) { if (onDone) onDone(); return; }
          const full = lines[li];
          let ci = 0;
          function typeChar() {
            if (ci > full.length) { typeLine(li + 1); return; }
            nodes[li].text(full.slice(0, ci));
            ci++;
            setTimeout(typeChar, charDelay);
          }
          typeChar();
        }
        typeLine(0);
      }

      // ---- cluster reveal sequence ----
      function revealCluster() {
        clusterPrefixNode.attr("opacity", 1);
        let ci = 0;
        function typeChar() {
          if (ci > clusterPrefix.length) {
            // prefix done — now type cluster name in color
            clusterNameNode.attr("opacity", 1);
            // reposition name node after prefix
            try {
              const prefixBBox = clusterPrefixNode.node().getBBox();
              clusterNameNode.attr("x", typeX + prefixBBox.width);
            } catch (e) { }
            let ni = 0;
            function typeName() {
              if (ni > clusterLabel.length) {
                // name fully typed — transition icon to cluster color
                if (iconPathGroup) {
                  iconPathGroup.selectAll("path, circle, rect, polygon, ellipse")
                    .transition().duration(600).ease(d3.easeCubicOut)
                    .style("fill", clusterColor)
                    .style("stroke", clusterColor);
                }
                badgeCircle.transition().duration(600).ease(d3.easeCubicOut)
                  .attr("stroke", clusterColor)
                  .attr("fill", clusterColor + "22"); // 13% tint
                return;
              }
              clusterNameNode.text(clusterLabel.slice(0, ni));
              ni++;
              setTimeout(typeName, CHAR_DELAY);
            }
            typeName();
            return;
          }
          clusterPrefixNode.text(clusterPrefix.slice(0, ci));
          ci++;
          setTimeout(typeChar, CHAR_DELAY);
        }
        typeChar();
      }

      // ---- fade everything out ----
      function fadeSelectedUI() {
        const allTrajNodes = tSvg.selectAll("*");
        allTrajNodes.transition().duration(FADE_OUT_DURATION).ease(d3.easeCubicOut).attr("opacity", 0);
      }

      // ==================== ANIMATION LOOP ====================
      let animFrame = 0;
      let typewriterStarted = false;
      const trailData = [];

      function animateMouse() {
        if (animFrame >= tickInputs.length) {
          // animation complete — start cluster reveal then fade
          revealCluster();
          setTimeout(fadeSelectedUI, FADE_OUT_DELAY);
          return;
        }

        // kick off typewriter after first few frames
        if (!typewriterStarted && animFrame > 20) {
          typewriterStarted = true;
          typeLines(statsLines, typeNodes, CHAR_DELAY, null);
        }

        const point = tickInputs[animFrame];
        const px = xScale(point.x);
        const py = yScale(point.y);

        cursor
          .attr("cx", px).attr("cy", py)
          .attr("fill", point.isDown ? CURSOR_DOWN_COLOR : CURSOR_UP_COLOR)
          .attr("opacity", 0.85);

        trailData.push({ x: px, y: py, isDown: point.isDown });
        if (trailData.length > MAX_TRAIL) trailData.shift();

        const segments = [];
        for (let j = 1; j < trailData.length; j++) {
          segments.push({
            x1: trailData[j - 1].x, y1: trailData[j - 1].y,
            x2: trailData[j].x, y2: trailData[j].y,
            opacity: j / trailData.length,
            isDown: trailData[j].isDown
          });
        }

        const lines = trailGroup.selectAll(".trail-segment").data(segments);
        lines.enter().append("line").attr("class", "trail-segment")
          .merge(lines)
          .attr("x1", d => d.x1).attr("y1", d => d.y1)
          .attr("x2", d => d.x2).attr("y2", d => d.y2)
          .attr("stroke", d => d.isDown ? CURSOR_DOWN_COLOR : CURSOR_UP_COLOR)
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", d => d.isDown ? "none" : "3,2")
          .attr("opacity", d => d.opacity * 0.7);
        lines.exit().remove();

        sampleText.text(`${animFrame + 1} / ${tickInputs.length}`).attr("opacity", 0.6);

        animFrame++;
        requestAnimationFrame(animateMouse);
      }

      animateMouse();
    });
  }

  // NOTE: renderMouseTrajectory is called directly from the circle click handler above,
  // passing the already-loaded `points` array. No secondary fetch needed.


  // ---------------- GLOBAL CLICK RESET ----------------
  document.addEventListener("click", function (event) {

    const clickedInsideScatter = event.target.closest("#scatter-plot");
    const clickedInsideLegend = event.target.closest(".pca-legend");
    const clickedInsideFilter = event.target.closest("#filter-container");

    // If click is inside ANY interactive component → ignore
    if (clickedInsideScatter || clickedInsideLegend || clickedInsideFilter) {
      return;
    }

    resetAll();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      resetAll();
    }
  });


  // ---------------- INITIAL RENDER ----------------
  applyFilter();
});