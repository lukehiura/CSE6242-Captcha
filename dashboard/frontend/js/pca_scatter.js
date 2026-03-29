Promise.all([
  d3.json("data/scatter_points.json"),
  d3.json("data/cluster_meta.json")
]).then(([points, clusters]) => {

  // ---------------- FEATURES ----------------
  const features = ["speed_mean","path_efficiency","pause_rate","duration"];

  // ---------------- DATA ----------------
  points = points.filter(d => !d.is_outlier);
  points.forEach(d => d.duration = Math.log(d.duration));

  const clusterNames = {
    0: "Fast-Balanced-Fluid",
    1: "Slow-Balanced-Fluid",
    2: "Moderate-Circuitous-Hesitant",
    3: "Moderate-Direct-Fluid"
  };

  const colorPalette = ["#4daf4a","#377eb8","#ff7f00","#e41a1c"];
  const colorMap = {};
  clusters.forEach((c,i)=> colorMap[c.id] = colorPalette[i]);

  // ---------------- FEATURE NORMALIZATION ----------------
  const featureScales = {};
  features.forEach(f => {
    const ext = d3.extent(points, d => d[f]);
    featureScales[f] = d3.scaleLinear().domain(ext).range([0,1]);
  });

  // ---------------- PCA SCATTER ----------------
  const scatterDiv = document.getElementById("scatter-plot");
  const width = scatterDiv.clientWidth;
  const height = scatterDiv.clientHeight;
  const margin = {top: 50, right: 50, bottom: 50, left: 50};

  const extent = d3.extent([...points.map(d => d.pca_x), ...points.map(d => d.pca_y)]);
  const x = d3.scaleLinear().domain(extent).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain(extent).range([height - margin.bottom, margin.top]);

  const xCenter = margin.left + (width - margin.left - margin.right) / 2;
  const yCenter = margin.top + (height - margin.top - margin.bottom) / 2;
  const labelDistFromAxes = 2*margin.left / 3;

  const svg = d3.select("#scatter-plot")
    .append("svg")
    .attr("width", "100%")
    .attr("height", "auto")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMin meet");

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  const circles = svg.selectAll("circle")
    .data(points)
    .enter()
    .append("circle")
    .attr("cx", d => x(d.pca_x))
    .attr("cy", d => y(d.pca_y))
    .attr("r", 3)
    .attr("fill", d => colorMap[d.cluster])
    .attr("opacity", 0.4);

  svg.append("text")
    .attr("x", xCenter)
    .attr("y", height - margin.bottom + labelDistFromAxes)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text("PC1");

  svg.append("text")
    .attr("transform", `translate(${margin.left - labelDistFromAxes}, ${yCenter}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text("PC2");

  // ---------------- CENTROIDS ----------------
  const centroids = d3.rollups(
    points,
    v => ({
      x: d3.mean(v, d => d.pca_x),
      y: d3.mean(v, d => d.pca_y),
      avgZ: features.map(f => d3.mean(v, d => d[f]))
    }),
    d => d.cluster
  );

  // ---------------- PCA LEGEND ----------------
  const squareSize = 12;
  const textGap = 6;
  const fontSize = 12;
  const legendItemSpacingY = fontSize * 1.5;

  const tempText = svg.append("text")
    .attr("class", "legend-text-temp")
    .style("font-size", `${fontSize}px`)
    .attr("visibility", "hidden");

  const maxTextWidth = d3.max(clusters.map(c => {
    tempText.text(clusterNames[c.id]);
    return tempText.node().getBBox().width;
  }));
  tempText.remove();

  const legendWidth = squareSize + textGap + maxTextWidth;
  const legendHeight = clusters.length * legendItemSpacingY;

  const pcaLegendGroup = svg.append("g")
    .attr("class", "pca-legend")
    .attr("transform", `translate(${width - margin.right - legendWidth}, ${height - margin.bottom - legendHeight})`);

  clusters.forEach((c, i) => {
    const g = pcaLegendGroup.append("g")
      .attr("class", "legend-item")
      .attr("data-cluster", c.id)
      .attr("transform", `translate(0, ${i * legendItemSpacingY})`)
      .style("cursor", "pointer");

    g.append("rect")
      .attr("width", squareSize)
      .attr("height", squareSize)
      .attr("x", 0)
      .attr("y", -squareSize / 2)
      .attr("fill", colorMap[c.id]);

    g.append("text")
      .text(clusterNames[c.id])
      .attr("x", squareSize + textGap)
      .attr("y", 0)
      .attr("dominant-baseline", "middle")
      .attr("class", "legend-text");

    g.on("mouseover", () => highlightCluster(c.id))
     .on("mouseout", () => resetHighlight())
     .on("click", () => highlightCluster(c.id));
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

  const radarSvgRoot = radarContainer
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${wrapperWidth} ${wrapperHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const radarSvg = radarSvgRoot.append("g")
    .attr("transform", `translate(${offsetX + radarRadius}, ${offsetY + radarRadius})`);

  const angleSlice = (2 * Math.PI) / features.length;
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
      .attr("class", "legend-text")
      .text(f);
  });

  function radarLine(values) {
    const scaled = values.map((v, i) => featureScales[features[i]](v));
    const closed = [...scaled, scaled[0]];
    return d3.lineRadial()
      .radius(v => v * radarRadius)
      .angle((_, i) => i * angleSlice)(closed);
  }

  const centroidPaths = radarSvg.selectAll(".centroid-radar")
    .data(centroids)
    .enter()
    .append("path")
    .attr("class", "centroid-radar")
    .attr("d", d => radarLine(d[1].avgZ))
    .attr("fill", "none")
    .attr("stroke", d => colorMap[d[0]])
    .attr("stroke-width", 2)
    .attr("opacity", 0.5);

  // ---------------- BOTTOM INFO TEXT ----------------
  const infoGroup = radarSvgRoot.append("g")
    .attr("transform", `translate(${wrapperWidth/2}, ${wrapperHeight - radarMargin.bottom/3})`);

  const infoText = infoGroup.append("text")
    .attr("text-anchor", "middle")
    .attr("class", "legend-text");

  const line1 = infoText.append("tspan")
    .text("Solid outline")
    .attr("font-weight", "bold");

  infoText.append("tspan").text(": cluster centroid averages");

  const filledTspan = infoText.append("tspan")
    .attr("x", 0)
    .attr("dy", "1.5em")
    .text("Filled polygon");

  infoText.append("tspan").text(": selected point behavior");

  // Background rectangle behind second line
  const bbox = filledTspan.node().getBBox();
  infoGroup.insert("rect", "text")
    .attr("x", bbox.x - 4)
    .attr("y", bbox.y - 2)
    .attr("width", bbox.width + 8)
    .attr("height", bbox.height + 4)
    .attr("fill", "#ddd")
    .attr("rx", 2);

  // ---------------- HIGHLIGHT FUNCTIONS ----------------
  function highlightCluster(clusterId) {
    circles.attr("opacity", d => d.cluster === clusterId ? 1 : 0.1);
    centroidPaths.attr("opacity", p => p[0] === clusterId ? 1 : 0.1);

    radarSvg.selectAll(".point-radar").remove();
    radarSvg.append("path")
      .attr("class","point-radar")
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

  function highlightPoint(point) {
    circles.attr("opacity", o => o.cluster === point.cluster ? 1 : 0.1);
    centroidPaths.attr("opacity", p => p[0] === point.cluster ? 1 : 0.1);

    radarSvg.selectAll(".point-radar").remove();
    radarSvg.append("path")
      .attr("class","point-radar")
      .attr("d", radarLine(features.map(f => point[f])))
      .attr("fill", colorMap[point.cluster])
      .attr("stroke", colorMap[point.cluster])
      .attr("opacity", 0.4);

    svg.selectAll(".pca-legend .legend-item text")
      .style("font-weight", "normal")
      .style("fill", "#000");

    svg.select(`.pca-legend .legend-item[data-cluster='${point.cluster}'] text`)
      .style("font-weight", "bold")
      .style("fill", colorMap[point.cluster]);
  }

  function resetHighlight() {
    circles.attr("opacity", 0.4);
    centroidPaths.attr("opacity", 0.5);
    radarSvg.selectAll(".point-radar").remove();
    svg.selectAll(".pca-legend .legend-item text")
      .style("font-weight", "normal")
      .style("fill", "#000");
  }

  circles.on("mouseover", (event, d) => highlightPoint(d))
         .on("mouseout", resetHighlight)
         .on("click", (event, d) => highlightCluster(d.cluster));

  // ---------------- TOOLTIP ----------------
  const tooltip = d3.select("#tooltip");
  circles.on("mouseover.tooltip", (event, d) => {
    tooltip.style("opacity", 1)
      .html(`
        <b>${d.cluster_name} (${d.cluster})</b><br/>
        <b>Game type:</b> ${d.game_type}<br/>
        <b>Speed mean:</b> ${d.speed_mean.toFixed(2)}<br/>
        <b>Path efficiency:</b> ${d.path_efficiency.toFixed(2)}<br/>
        <b>Pause rate:</b> ${d.pause_rate.toFixed(2)}<br/>
        <b>Duration:</b> ${d.duration.toFixed(2)}<br/>
        <b>Anomaly score:</b> ${d.anomaly_score.toFixed(2)}
      `)
      .style("left", (event.pageX + 10) + "px")
      .style("top", (event.pageY - 20) + "px");
  })
  .on("mouseout.tooltip", () => {
    tooltip.style("opacity", 0);
  });
// ---------------- GAME TYPE FILTERS ----------------
const filterContainer = d3.select("#filter-container");

const filterSize = 70;       // slightly bigger
const filterSpacing = 25;

// Use your external SVG icons
const gameFilters = [
  { id: "sheep", label: "Sheep", svgPath: svgIcons.sheep },
  { id: "thread", label: "Thread", svgPath: svgIcons.thread },
  { id: "polygon", label: "Polygon", svgPath: svgIcons.polygon }
];

// Create SVG
const filterGroup = filterContainer.append("svg")
  .attr("width", filterSize * 2)
  .attr("height", (filterSize + filterSpacing) * gameFilters.length);

// Track selected filter
let selectedFilter = null;

// ---------------- GAME TYPE FILTERS ----------------
// Configurable margins for filter group
const filterMarginTop = 5;       // top padding
const filterMarginLeft = 0;      // left padding
const filterVerticalSpacing = 20; // space between circles

const filterItems = filterGroup.selectAll(".filter-item")
  .data(gameFilters)
  .enter()
  .append("g")
  .attr("class", "filter-item")
  .attr("transform", (d, i) => {
    const xPos = filterMarginLeft + filterSize; // left margin + radius offset
    const yPos = filterMarginTop + i * (filterSize + filterVerticalSpacing) + filterSize / 2;
    return `translate(${xPos}, ${yPos})`;
  })
  .style("cursor", "pointer")
  .on("click", function(event, d) {
    selectedFilter = selectedFilter === d.id ? null : d.id;
    updateFilterSelection();
    applyFilter(selectedFilter);
  });

// ---------------- OUTER CIRCLE ----------------
filterItems.append("circle")
  .attr("r", filterSize / 2)
  .attr("fill", "#f0f0f0")
  .attr("stroke", "#999")
  .attr("stroke-width", 2);

// ---------------- ICONS (SVG SUPPORT) ----------------
filterItems.append("g")
  .attr("class", "icon-wrapper")
  .each(function(d) {
    const g = d3.select(this);
    g.html(svgIcons[d.id]);
    const bbox = g.node().getBBox();
    const scale = (filterSize * 0.5) / Math.max(bbox.width, bbox.height);
    g.attr("transform", `
      translate(${-bbox.x * scale - bbox.width * scale / 2},
                ${-bbox.y * scale - bbox.height * scale / 2})
      scale(${scale})
    `);
  });

// ---------------- HIGHLIGHT SELECTION ----------------
function updateFilterSelection() {
  filterItems.select("circle")
    .attr("stroke", d => d.id === selectedFilter ? "#000000" : "#999")
    .attr("stroke-width", d => d.id === selectedFilter ? 4 : 2);

  // Optional: bold text if you add text labels next to circles
  filterItems.select("text")
    .style("font-weight", d => d.id === selectedFilter ? "bold" : "normal");
}

// ---------------- APPLY FILTER ----------------
function applyFilter(filterId) {
  console.log("Filter selected:", filterId);
  d3.selectAll("#scatter-plot circle")
    .attr("opacity", d => {
      if (!filterId) return 0.4;
      return d.game_type === filterId ? 1 : 0.1;
    });
}

// ---------------- ADD TEXT LABELS ----------------
filterItems.append("text")
  .attr("x", filterSize + 8) // offset right of circle
  .attr("y", 0)
  .attr("dominant-baseline", "middle")
  .style("font-size", "14px")
  .text(d => d.name); // assuming gameFilters has a "name" field



});