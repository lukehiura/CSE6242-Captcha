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
  state = {
    selectedClusters: new Set(), // can hold multiple clusters
    selectedGames: new Set(),    // can hold multiple games
    hoveredCluster: null,
    hoveredGame: null,
    hoveredPoint: null,
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
  const SCATTER_PREVIEW_OPACITY = 0.2;
  const SCATTER_SELECTED_OPACITY = 0.5;
  const SCATTER_UNSELECTED_OPACITY = 0.01;

  // Radar opacity
  const RADAR_HOVER_OPACITY = 0.2;
  const RADAR_SELECTED_OPACITY = 0.5;
  const RADAR_UNSELECTED_OPACITY = 0.01;

  // Core UI transitions (filters, hover, selection updates)
  const TRANSITION_DURATION = 300;

  // Trajectory + selection fade timing (synced)
  const FADE_DURATION = 1500;

  // Delay before fade starts after animation completes
  const FADE_DELAY = 5000;

  // Optional: easing for smoother animations (recommended)
  const EASING = d3.easeCubicOut;

  // ---------------- DATA PREPROCESSING ----------------
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
    .style("font-weight", "bold")
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
    const infoWidth = scatterDiv.clientWidth;
    const infoHeight = scatterDiv.clientHeight;
    const infoMargin = { top: 10, right: 10, bottom: 10, left: 10 };

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
      .attr("fill", "#000")
      .attr("dominant-baseline", "hanging");
  }


  d3.selectAll(".data-point")
    .on("click", function (event, d) {
      showPointInfo(d);
    });


  // ---------------- RADAR ----------------
  const radarContainer = d3.select("#radar");
  const wrapperWidth = radarContainer.node().clientWidth;
  const wrapperHeight = radarContainer.node().clientHeight;
  const radarMargin = { top: 20, right: 45, bottom: 70, left: 45 };
  const innerWidth = wrapperWidth - radarMargin.left - radarMargin.right;
  const innerHeight = wrapperHeight - radarMargin.top - radarMargin.bottom;
  const radarSize = Math.min(innerWidth, innerHeight);
  const radarRadius = radarSize / 2;
  const offsetX = radarMargin.left + (innerWidth - radarSize) / 2;
  const offsetY = radarMargin.top + (innerHeight - radarSize) / 2;

  const radarSvgRoot = radarContainer.append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${wrapperWidth} ${wrapperHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const radarSvg = radarSvgRoot.append("g")
    .attr("transform", `translate(${offsetX + radarRadius},${offsetY + radarRadius})`);

  // ---------------- BOTTOM INFO TEXT ----------------
  const radarLegend = radarSvgRoot.append("g")
    .attr("transform", `translate(${wrapperWidth / 2}, ${wrapperHeight - radarMargin.bottom / 3})`);

  radarLegend.append("text")
    .attr("text-anchor", "middle")
    .attr("class", "filters-text")
    .html(`<tspan font-weight="bold">Solid outline</tspan>: cluster centroid averages`);


  // ----- LINE 2 -----
  const line2Group = radarLegend.append("g");


  // Create full sentence FIRST (hidden for measurement)
  const fullText = line2Group.append("text")
    .attr("class", "filters-text")
    .attr("text-anchor", "middle")
    .attr("visibility", "hidden");

  fullText.append("tspan").text("Filled polygon");
  fullText.append("tspan").text(": selected point behavior");

  // Measure full sentence
  const fullBBox = fullText.node().getBBox();

  // Center the whole group
  line2Group.attr("transform", "translate(0, 16)");


  // Measure JUST "Filled polygon"
  const line2tempText = line2Group.append("text")
    .attr("class", "filters-text")
    .attr("text-anchor", "start")
    .text("Filled polygon");

  const bbox = line2tempText.node().getBBox();


  // Draw rectangle
  line2Group.insert("rect", "text")
    .attr("x", -fullBBox.width / 2 - 2)
    .attr("y", bbox.y - 1)
    .attr("width", bbox.width + 4)
    .attr("height", bbox.height + 2)
    .attr("fill", "#ddd")
    .attr("rx", 2);


  // Show final text
  fullText.attr("visibility", "visible");

  // Remove temp
  line2tempText.remove();

  // ---------------- HIGHLIGHT FUNCTIONS ----------------
  function highlightCluster(clusterId) {
    circles.attr("opacity", d => d.cluster === clusterId ? 1 : 0.1);
    centroidPaths.attr("opacity", p => p[0] === clusterId ? 1 : 0.1);

    radarSvg.selectAll(".point-radar").remove();
    radarSvg.append("path")
      .attr("class", "point-radar")
      .attr("d", radarLine(centroids.find(d => d[0] === clusterId)[1].avgZ))
      .attr("fill", colorMap[clusterId])
      .attr("stroke", colorMap[clusterId])
      .attr("opacity", 0.4);

    svg.selectAll(".pca-legend .legend-item text")
      .style("font-weight", "normal")
      .style("fill", "#000");

    svg.select(`.pca-legend .legend-item[data-cluster='${clusterId}'] text`)
      .style("font-weight", "bold")
      .style("fill", colorMap[clusterId]);
  }

  const angleSlice = 2 * Math.PI / features.length;
  const ringCount = 4;
  for (let i = 1; i <= ringCount; i++) {
    radarSvg.append("circle")
      .attr("r", radarRadius * (i / ringCount))
      .attr("fill", "none")
      .attr("stroke", "#ccc")
      .attr("stroke-dasharray", "2,2");
  }

  features.forEach((f, i) => {
    const angle = i * angleSlice - Math.PI / 2;
    radarSvg.append("line")
      .attr("x1", 0).attr("y1", 0)
      .attr("x2", Math.cos(angle) * radarRadius)
      .attr("y2", Math.sin(angle) * radarRadius)
      .attr("stroke", "#999");
    radarSvg.append("text")
      .attr("x", Math.cos(angle) * (radarRadius + 12))
      .attr("y", Math.sin(angle) * (radarRadius + 12))
      .attr("text-anchor", "middle")
      .attr("alignment-baseline", "middle")
      .attr("class", "filters-text")
      .text(f);
  });

  function radarLine(values) {
    const scaled = values.map((v, i) => featureScales[features[i]](v));
    const closed = [...scaled, scaled[0]];
    return d3.lineRadial()
      .radius(v => v * radarRadius)
      .angle((_, i) => i * angleSlice)(closed);
  }

  // ---------------- CENTROIDS ----------------
  let centroids = d3.rollups(
    currentPoints,
    v => ({
      x: d3.mean(v, d => d.pca_x),
      y: d3.mean(v, d => d.pca_y),
      avgZ: features.map(f => d3.mean(v, d => d[f]))
    }),
    d => d.cluster
  );

  let centroidPaths = radarSvg.selectAll(".centroid-radar")
    .data(centroids, d => d[0])
    .join(
      enter => enter.append("path")
        .attr("class", "centroid-radar")
        .attr("fill", "none")
        .attr("stroke", d => colorMap[d[0]])
        .attr("stroke-width", 2)
        .attr("d", d => radarLine(d[1].avgZ))
    );


  const hoveredRadarPath = radarSvg.append("path")
    .attr("class", "point-radar")
    .attr("fill", "none")
    .attr("stroke-width", 2)
    .attr("pointer-events", "none")
    .style("opacity", 0); // start hidden


  function attachCircleHover(circles) {
    let tooltipTimeout;

    circles.on("mouseover", function (event, d) {
      const opacity = +d3.select(this).style("opacity");
      if (opacity < 0.1) return; // ignore invisible points only

      if (tooltipTimeout) clearTimeout(tooltipTimeout);
      state.hoveredPoint = d;

      // ---------------- TOOLTIP ----------------
      tooltip.html(buildTooltipHTML(d));
      tooltip.style("opacity", 1);

      // ---------------- RADAR POLYGON TRANSITION ----------------
      hoveredRadarPath.transition().duration(100)
        .attr("d", radarLine(features.map(f => d[f])))
        //.attr("stroke", colorMap[d.cluster])
        .attr("fill", colorMap[d.cluster])
        .attr("fill-opacity", 0.2)
        //.attr("stroke-opacity", 1)
        .style("opacity", 1);

    })
      .on("mousemove", (event) => {
        tooltip.style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 20) + "px");
      })
      .on("mouseout", () => {
        state.hoveredPoint = null;

        // Small delay before hiding tooltip & polygon
        tooltipTimeout = setTimeout(() => {
          tooltip.style("opacity", 0);
          hoveredRadarPath.transition().duration(250)
            .style("opacity", 0); // fade out smoothly
        }, 50);
      })
      .on("click", function (event, d) {
        event.stopPropagation();
        if (!currentPoints.includes(d)) return;

        const id = d.hf_index;
        if (state.selectedPoint === id) {
          state.selectedPoint = null;

          // Clear info panel
          d3.select("#selected-point-info").html("")
            .style("display", "none");

          // clear trajectory
          d3.select("#trajectory-plot").html("");
          d3.select("#trajectory-caption").html("");

        } else {
          state.selectedPoint = id;

          // Update info panel
          d3.select("#selected-point-info")
            .html(buildTooltipHTML(d))
            .classed("tooltip-style", true);

          // Render trajectory
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
      updateLegendAppearance(); // hover = style only
    })
    .on("mouseout", () => {
      state.hoveredCluster = null;
      updateLegendAppearance();
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
    .attr("cx", circleRadius)
    .attr("cy", circleRadius)
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
    .attr("fill", "#f0f0f0")
    .attr("stroke", "#999")
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
      updateFilterAppearance();   // style only (no filtering)
      updateVisuals();            // preview effect
    })
    .on("mouseout", () => {
      state.hoveredGame = null;
      updateFilterAppearance();
      updateVisuals();
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

      updateFilterAppearance(); // for game filters
      applyFilter();
    });


  function updateFilterAppearance() {
    filterItems.each(function (d) {
      const g = d3.select(this);
      const isHovered = state.hoveredGame === d.id;
      const isSelected = state.selectedGames.has(d.id);

      // --- Circle ---
      g.select("circle")
        .attr("stroke", isSelected ? "#000" : "#999")
        .attr("stroke-width", isHovered || isSelected ? 3 : 2);

      // --- Text ---
      g.select("text")
        .classed("hovered", isHovered)
        .classed("selected", isSelected);

      // --- Optional: icon emphasis ---
      g.select(".icon-wrapper")
        .style("opacity", isHovered || isSelected ? 1 : 0.7);
    });
  }


  // ---------------- COMPUTE CLUSTER CENTROIDS ----------------
  function computeClusterCentroids(filteredPoints) {
    const clustersMap = d3.group(filteredPoints, d => d.cluster);
    const centroids = new Map();

    clustersMap.forEach((pointsInCluster, clusterId) => {
      if (!pointsInCluster.length) return;
      const meanValues = {};
      features.forEach(f => {
        meanValues[f] = d3.mean(pointsInCluster, d => d[f]);
      });
      centroids.set(clusterId, meanValues);
    });

    return centroids;
  }


  /*
  // ---------- Get Active Centroids & Update Radar ----------
  function getActiveCentroids() {
    // active clusters: selected + hovered
    const activeClusters = new Set([...state.selectedClusters]);
    if (state.hoveredCluster !== null) activeClusters.add(state.hoveredCluster);

    return d3.rollups(
      currentPoints.filter(d => activeClusters.size === 0 || activeClusters.has(d.cluster)),
      v => ({
        x: d3.mean(v, d => d.pca_x),
        y: d3.mean(v, d => d.pca_y),
        avgZ: features.map(f => d3.mean(v, d => d[f]))
      }),
      d => d.cluster
    );
  }
*/

  function updateRadarChart(centroids) {
    const radarGroups = radarSvg.selectAll(".radar-cluster")
      .data([...centroids.entries()], d => d[0]);

    radarGroups.join(
      enter => enter.append("path")
        .attr("class", "radar-cluster")
        .attr("fill", "none")
        .attr("stroke-width", 1.5)
        .attr("stroke", d => colorMap[d[0]] || "#000")
        .attr("stroke-opacity", 0.5)
        .attr("d", d => radarLine(Object.values(d[1]))),
      update => update
        .transition().duration(200)
        .attr("d", d => radarLine(Object.values(d[1])))
        .attr("stroke", d => colorMap[d[0]] || "#000")
        .attr("stroke-opacity", 0.5),
      exit => exit.remove()
    );
  }

  // ---------------- APPLY FILTER ----------------
  function applyFilter() {
    // ---------------- BUILD ACTIVE SETS ----------------
    const activeClusters = new Set([...state.selectedClusters]);
    const activeGameTypes = new Set([...state.selectedGames].map(id => gameIdToType[id]));

    // ---------------- FILTER POINTS ----------------
    const filteredPoints = points.filter(d => {
      const clusterMatch = activeClusters.size === 0 || activeClusters.has(d.cluster);
      const gameMatch = activeGameTypes.size === 0 || activeGameTypes.has(d.game_type);
      return clusterMatch && gameMatch;
    });

    // ---------------- UPDATE RADAR CHART ----------------
    state.clusterCentroids = computeClusterCentroids(filteredPoints);
    updateRadarChart(state.clusterCentroids);

    // ---------------- UPDATE SCATTER POINTS ----------------
    const circleSel = svg.selectAll("circle")
      .data(filteredPoints, d => d.id || (d.pca_x + "-" + d.pca_y));

    circleSel.join(
      enter => enter.append("circle")
        .attr("cx", d => x(d.pca_x))
        .attr("cy", d => y(d.pca_y))
        .attr("r", 1.5)
        .attr("fill", d => colorMap[d.cluster])
        .attr("opacity", 0)
        .style("cursor", "pointer")
        .call(sel => sel.transition().duration(150)
          .attr("opacity", SCATTER_SELECTED_OPACITY)),

      update => update
        .attr("cx", d => x(d.pca_x))
        .attr("cy", d => y(d.pca_y))
        .attr("r", 1.5)
        .attr("fill", d => colorMap[d.cluster])
        .attr("opacity", SCATTER_SELECTED_OPACITY)
        .attr("stroke", "none")
        .attr("stroke-width", 0),

      exit => exit.transition().duration(150)
        .attr("opacity", 0)
        .remove()
    );
  }

  // ---------------- UPDATE VISUALS ----------------
  function updateVisuals() {
    const noSelection = state.selectedClusters.size === 0 && state.selectedGames.size === 0;

    // Prepare active sets including hover previews
    const activeClusters = new Set(state.selectedClusters);
    if (state.hoveredCluster !== null && !state.selectedClusters.has(state.hoveredCluster)) {
      activeClusters.add(state.hoveredCluster);
    }

    const activeGames = new Set([...state.selectedGames].map(id => gameIdToType[id]));
    if (state.hoveredGame !== null && !state.selectedGames.has(state.hoveredGame)) {
      const hoveredType = gameIdToType[state.hoveredGame];
      if (hoveredType) activeGames.add(hoveredType);
    }

    // Bring selected point to top
    if (state.selectedPoint !== null) {
      circles.filter(d => d.hf_index === state.selectedPoint).raise();
    }

    // Update attributes directly for smoothness
    circles
      .attr("cx", d => x(d.pca_x))
      .attr("cy", d => y(d.pca_y))
      .attr("r", 1.5)  // always reset
      .attr("fill", d => colorMap[d.cluster])
      .attr("opacity", d => {
        if (d.hf_index === state.selectedPoint) return 1;

        const clusterMatch = activeClusters.size === 0 || activeClusters.has(d.cluster);
        const gameMatch = activeGames.size === 0 || activeGames.has(d.game_type);
        if (!clusterMatch || !gameMatch) return 0;

        const baseClusterMatch = state.selectedClusters.size === 0 || state.selectedClusters.has(d.cluster);
        const baseGameMatch = state.selectedGames.size === 0 || state.selectedGames.has(gameTypeToId[d.game_type]);
        const isPreview = !baseClusterMatch || !baseGameMatch;

        return noSelection ? SCATTER_SELECTED_OPACITY
          : isPreview ? SCATTER_PREVIEW_OPACITY
            : SCATTER_SELECTED_OPACITY;
      })
      .attr("stroke", d => d.hf_index === state.selectedPoint ? "#000" : "none")
      .attr("stroke-width", d => d.hf_index === state.selectedPoint ? 2 : 0);
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

      // ---------------- CONFIG ----------------
      const CURSOR_UP_COLOR = "#ddd";
      const CURSOR_DOWN_COLOR = "black";
      const width = trajDiv.clientWidth;
      const height = trajDiv.clientHeight;
      const margin = { top: 10, right: 10, bottom: 10, left: 10 };
      const MAX_TRAIL = 600;
      const FADE_DURATION = 600;
      const FADE_DELAY = 2000;
      const EASING = d3.easeCubic;

      // ---------------- SVG ----------------
      const svg = d3.select(`#${targetDivId}`)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMinYMin meet");

      // ---------------- LAYOUT SPLIT ----------------
      const leftHalf = width / 2;

      // ---------------- LEFT BACKGROUND ----------------
      svg.append("rect")
        .attr("x", margin.left)
        .attr("y", margin.top)
        .attr("width", leftHalf - margin.left - margin.right)
        .attr("height", height - margin.top - margin.bottom)
        .attr("fill", "#f9f9f9")
        .attr("stroke", "#ccc")
        .attr("stroke-width", 1);

      // ---------------- SCALES ----------------
      const xScale = d3.scaleLinear()
        .domain(d3.extent(tickInputs, d => d.x))
        .range([margin.left, leftHalf - margin.right]);

      const yScale = d3.scaleLinear()
        .domain(d3.extent(tickInputs, d => d.y))
        .range([height - margin.bottom, margin.top]);

      // ---------------- ICON + CLUSTER GROUP ----------------
      const selectedIconGroup = svg.append("g")
        .attr("class", "selected-game-icon")
        .attr("transform", `translate(${leftHalf + margin.right}, ${margin.top})`);

      // ---------------- UPDATE SELECTED GAME & CLUSTER ----------------
      function updateSelectedGameAndCluster(selectedGameId, hfIndex) {
        selectedIconGroup.html(""); // clear previous

        if (!selectedGameId || hfIndex == null) return;

        // ----- GAME ICON -----
        const iconSvg = svgIcons[selectedGameId];

        if (iconSvg) {
          const iconGroup = selectedIconGroup.append("g").attr("class", "icon-wrapper");

          // Add background circle
          const circleRadius = (height - margin.top - margin.bottom) / 10;
          iconGroup.append("circle")
            .attr("r", circleRadius)
            .attr("fill", "#f0f0f0")
            .attr("stroke", "#999")
            .attr("stroke-width", 1);

          // Add the icon SVG
          const gIcon = iconGroup.append("g").html(iconSvg);
          console.log("gIcon node:", gIcon.node());

          // Scale and center icon inside circle
          const bbox = gIcon.node().getBBox();
          console.log("bbox:", bbox);

          const scale = (circleRadius * 1.35) / Math.max(bbox.width, bbox.height);
          gIcon.attr("transform",
            `translate(${-bbox.x * scale - bbox.width * scale / 2},${-bbox.y * scale - bbox.height / 2}) scale(${scale})`
          );
        }

        // ----- CLUSTER COLOR -----
        const pointData = scatterPoints.find(p => p.hf_index === hfIndex);
        console.log("pointData:", pointData);

        const selectedClusterId = pointData?.cluster;
        console.log("selectedClusterId:", selectedClusterId);

        const clusterColor = colorMap[selectedClusterId] || "#888";
        console.log("pointData:", pointData);
        console.log("selectedClusterId:", selectedClusterId);
        console.log("clusterColor:", clusterColor);

        if (selectedClusterId != null) {
          const squareSize = margin.top / 2;
          selectedIconGroup.append("rect")
            .attr("x", -squareSize * 2.5)
            .attr("y", -squareSize / 2)
            .attr("width", squareSize)
            .attr("height", squareSize)
            .attr("fill", clusterColor)
            .attr("stroke", "#333")
            .attr("stroke-width", 1)
            .attr("opacity", 0.9);
        }
      }

      // Call initial state
      updateSelectedGameAndCluster(gameTypeToId[gameType], hfIndex);

      // ---------------- CURSOR ----------------
      const cursor = svg.append("circle")
        .attr("r", 5)
        .attr("fill", CURSOR_UP_COLOR)
        .attr("opacity", 0.8);

      const trailData = [];

      // ---------------- LEGEND ----------------
      const legendItems = [
        { label: "Mouse Up", color: CURSOR_UP_COLOR },
        { label: "Mouse Down", color: CURSOR_DOWN_COLOR }
      ];

      const legendGroup = svg.append("g")
        .attr("transform", `translate(${margin.left}, ${height - margin.bottom})`);

      let cursorX = 0;
      const dotRadius = 5, textOffset = 4;
      let sampleText = legendGroup.append("text").text("")
        .attr("x", width / 2 - margin.right - margin.left)
        .attr("y", 2 * margin.bottom / 3 + 1.5)// +1.5 to match Mouse up Mouse down below
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("class", "filters-text");

      legendItems.forEach(item => {
        legendGroup.append("circle").attr("r", dotRadius).attr("fill", item.color).attr("cx", cursorX).attr("cy", 2 * margin.bottom / 3);
        legendGroup.append("text").text(item.label)
          .attr("x", cursorX + dotRadius + textOffset)
          .attr("y", 2 * margin.bottom / 3 + 1.5) // slight tweak because dominant baseline is not perfectly center aligned 
          .attr("dominant-baseline", "middle")
          .attr("class", "filters-text");
        cursorX += dotRadius * 2 + textOffset + item.label.length * 6 + 10;
      });

      // ---------------- ANIMATION ----------------
      let i = 0;
      function animateMouse() {
        if (i >= tickInputs.length) {
          setTimeout(() => {
            cursor.transition().duration(FADE_DURATION).ease(EASING).attr("opacity", 0);
            sampleText.transition().duration(FADE_DURATION).ease(EASING).attr("opacity", 0);
            svg.selectAll(".trail-segment").transition().duration(FADE_DURATION).ease(EASING).attr("opacity", 0).remove();
            fadeSelectedUI();
          }, FADE_DELAY);
          return;
        }

        const point = tickInputs[i];
        const px = xScale(point.x);
        const py = yScale(point.y);

        cursor.attr("cx", px).attr("cy", py)
          .attr("fill", point.isDown ? CURSOR_DOWN_COLOR : CURSOR_UP_COLOR)
          .attr("opacity", 0.8);

        trailData.push({ x: px, y: py, isDown: point.isDown });
        if (trailData.length > MAX_TRAIL) trailData.shift();

        const segments = [];
        for (let j = 1; j < trailData.length; j++) {
          segments.push({
            x1: trailData[j - 1].x, y1: trailData[j - 1].y,
            x2: trailData[j].x, y2: trailData[j].y,
            opacity: j / trailData.length, isDown: trailData[j].isDown
          });
        }

        const lines = svg.selectAll(".trail-segment").data(segments);
        lines.enter().append("line").attr("class", "trail-segment")
          .merge(lines)
          .attr("x1", d => d.x1)
          .attr("y1", d => d.y1)
          .attr("x2", d => d.x2)
          .attr("y2", d => d.y2)
          .attr("stroke", d => d.isDown ? CURSOR_DOWN_COLOR : CURSOR_UP_COLOR)
          .attr("stroke-width", 2)
          .attr("stroke-dasharray", d => d.isDown ? "0" : "4,2")
          .attr("opacity", d => d.opacity);
        lines.exit().remove();

        sampleText.text(`Sample: ${point.sampleIndex}`).attr("opacity", 1);

        i++;
        requestAnimationFrame(animateMouse);
      }

      animateMouse();
    });
  }

  // ---------------- CALL AFTER PROMISE.ALL ----------------
  Promise.all([
    d3.json(`${API_BASE}/scatter_points.json`),
    d3.json(`${API_BASE}/cluster_meta.json`)
  ]).then(([scatterPoints, clusters]) => {
    // pass scatterPoints to render function
    renderMouseTrajectory(hfIndex, "trajectoryDiv", "#trajectoryCaption", scatterPoints);
  });


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