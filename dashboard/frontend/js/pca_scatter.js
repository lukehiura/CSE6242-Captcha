Promise.all([
  d3.json("data/scatter_points.json"),
  d3.json("data/cluster_meta.json")
]).then(([points, clusters]) => {

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
    const ext = d3.extent(points, d=>d[f]);
    featureScales[f] = d3.scaleLinear().domain(ext).range([0,1]);
  });

  // ---------------- PCA SCATTER ----------------
  const scatterDiv = document.getElementById("scatter-plot");
  const width = scatterDiv.clientWidth;
  const height = scatterDiv.clientHeight;
  const margin = {top: 60, right: 60, bottom: 60, left: 60};

  const extent = d3.extent([...points.map(d=>d.pca_x), ...points.map(d=>d.pca_y)]);
  const x = d3.scaleLinear().domain(extent).range([margin.left, width-margin.right]);
  const y = d3.scaleLinear().domain(extent).range([height-margin.bottom, margin.top]);

  const svg = d3.select("#scatter-plot")
    .append("svg")
    .attr("width", "100%")
    .attr("height", "auto")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMin meet");

  svg.append("g")
    .attr("transform", `translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x));
  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  const circles = svg.selectAll("circle")
    .data(points)
    .enter()
    .append("circle")
    .attr("cx", d=>x(d.pca_x))
    .attr("cy", d=>y(d.pca_y))
    .attr("r", 3)
    .attr("fill", d=>colorMap[d.cluster])
    .attr("opacity", 0.4);

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", height - margin.bottom / 3)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text("PC1");

  svg.append("text")
    .attr("x", -height / 2)
    .attr("y", margin.left / 3)
    .attr("transform", "rotate(-90)")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text("PC2");

  // ---------------- CENTROIDS ----------------
  const centroids = d3.rollups(
    points,
    v => ({
      x: d3.mean(v,d=>d.pca_x),
      y: d3.mean(v,d=>d.pca_y),
      avgZ: features.map(f => d3.mean(v,d=>d[f]))
    }),
    d=>d.cluster
  );

  // ---------------- RADAR ----------------
  const radarContainer = d3.select("#radar");
  const radarWrapperWidth = radarContainer.node().clientWidth;
  const radarWrapperHeight = radarContainer.node().clientHeight;
  const radarSize = Math.min(radarWrapperWidth, radarWrapperHeight);
  const radarRadius = radarSize / 2.5;

  const radarSvg = radarContainer
    .append("svg")
    .attr("viewBox", `-20 -20 ${radarSize+40} ${radarSize+40}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "auto")
    .append("g")
    .attr("transform", `translate(${radarSize / 2}, ${radarSize / 2})`);

  const angleSlice = (2 * Math.PI) / features.length;
  const ringCount = 4;

  for (let i = 1; i <= ringCount; i++) {
    radarSvg.append("circle")
      .attr("r", radarRadius * (i / ringCount))
      .attr("fill", "none")
      .attr("stroke", "#ccc")
      .attr("stroke-dasharray", "2,2")
      .attr("opacity", 1);
  }

  features.forEach((f, i) => {
    const angle = i * angleSlice - Math.PI / 2;
    radarSvg.append("line")
      .attr("x1", 0).attr("y1", 0)
      .attr("x2", Math.cos(angle) * radarRadius)
      .attr("y2", Math.sin(angle) * radarRadius)
      .attr("stroke", "#999")
      .attr("stroke-width", 1);

    radarSvg.append("text")
      .attr("x", Math.cos(angle) * (radarRadius + 10))
      .attr("y", Math.sin(angle) * (radarRadius + 10))
      .attr("text-anchor", "middle")
      .attr("alignment-baseline", "middle")
      .style("font-size", "0.75rem")
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

  // -------------------- RADAR INFO ----------------
  const radarInfo = d3.select("#radar-wrapper .info")
    .style("transition", "font-size 0.3s ease"); // smooth transition

  function updateRadarInfoFont() {
    const wrapperWidth = document.getElementById("radar-wrapper").clientWidth;
    const fontSize = Math.max(10, wrapperWidth / 32);
    radarInfo.style("font-size", fontSize + "px");
  }

  updateRadarInfoFont();
  window.addEventListener("resize", () => {
    clearTimeout(window.radarResizeTimeout);
    window.radarResizeTimeout = setTimeout(updateRadarInfoFont, 100); // debounce
  });

  // -------------------- LEGEND ----------------
  const legend = d3.select("#legend")
	.style("transition", "all 0.3s ease"); // smooth transitions
  legend.html(""); // initial draw

  const legendRows = {};

  // Initial draw
  clusters.forEach(c => {
	const row = legend.append("div")
		.style("cursor", "pointer")
		.style("display", "flex")
		.style("align-items", "center")
		.style("margin-bottom", "4px");
    legendRows[c.id] = row;

    // Color box
    row.append("span")
      .attr("class","color-box")
      .style("display", "inline-block")
      .style("background", colorMap[c.id]);

    // Label
    row.append("span")
      .attr("class","label")
      .text(clusterNames[c.id])
      .style("color", "#000")
      .style("font-weight", "normal");

    // Hover interaction
    row.on("mouseover", () => highlightCluster(c.id))
       .on("mouseout", () => resetHighlight());
  });

// Function to dynamically resize legend elements without redrawing
  function updateLegendSizes() {
    const legendWidth = legend.node().clientWidth;
    const boxSize = Math.max(12, Math.min(19.2, legendWidth/20));
    const fontSize = Math.max(12, Math.min(19.2, legendWidth/20));

    Object.values(legendRows).forEach(row => {
      row.style("height", `${boxSize*1.5}px`);
      row.select(".color-box")
        .style("width", `${boxSize}px`)
        .style("height", `${boxSize}px`)
        .style("margin-right", `${boxSize/2}px`);
      row.select(".label")
        .style("font-size", `${fontSize}px`)
        .style("margin-left", `${boxSize/2}px`);
    });
  }

// Initial sizing
updateLegendSizes();

// Debounced resize for smooth behavior
window.addEventListener("resize", () => {
  clearTimeout(window.legendResizeTimeout);
  window.legendResizeTimeout = setTimeout(updateLegendSizes, 100);
});
  // ---------------- TOOLTIP ----------------
  const tooltip = d3.select("#tooltip");

  function highlightCluster(clusterId){
    circles.attr("opacity", d => d.cluster === clusterId ? 1 : 0.1);
    centroidPaths.attr("opacity", p => p[0] === clusterId ? 1 : 0.1);
    radarSvg.selectAll(".point-radar").remove();
    radarSvg.append("path")
      .attr("class","point-radar")
      .attr("d", radarLine(centroids.find(d=>d[0]===clusterId)[1].avgZ))
      .attr("fill", colorMap[clusterId])
      .attr("stroke", colorMap[clusterId])
      .attr("opacity",0.4);
    Object.values(legendRows).forEach(r => r.select("span:nth-child(2)").style("font-weight","normal").style("color","#000"));
    legendRows[clusterId].select("span:nth-child(2)").style("font-weight","bold").style("color", colorMap[clusterId]);
  }

  function highlightPoint(point){
    circles.attr("opacity", o => o.cluster === point.cluster ? 1 : 0.1);
    centroidPaths.attr("opacity", p => p[0] === point.cluster ? 1 : 0.1);
    radarSvg.selectAll(".point-radar").remove();
    radarSvg.append("path")
      .attr("class","point-radar")
      .attr("d", radarLine(features.map(f=>point[f])))
      .attr("fill", colorMap[point.cluster])
      .attr("stroke", colorMap[point.cluster])
      .attr("opacity",0.4);
    Object.values(legendRows).forEach(r => r.select("span:nth-child(2)").style("font-weight","normal").style("color","#000"));
    legendRows[point.cluster].select("span:nth-child(2)").style("font-weight","bold").style("color", colorMap[point.cluster]);
  }

  function resetHighlight(){
    circles.attr("opacity",0.4);
    centroidPaths.attr("opacity",0.5);
    radarSvg.selectAll(".point-radar").remove();
    Object.values(legendRows).forEach(r => r.select("span:nth-child(2)").style("font-weight","normal").style("color","#000"));
  }

  circles.on("mouseover", (event,d)=>{
    highlightPoint(d);
    tooltip.style("opacity",1)
      .html(`
        <strong>Cluster:</strong> ${d.cluster_name} (${d.cluster})<br/>
        <strong>Game Type:</strong> ${d.game_type}<br/>
        <strong>Speed Mean:</strong> ${d.speed_mean.toFixed(2)}<br/>
        <strong>Path Efficiency:</strong> ${d.path_efficiency.toFixed(2)}<br/>
        <strong>Pause Rate:</strong> ${d.pause_rate.toFixed(2)}<br/>
        <strong>Duration:</strong> ${d.duration.toFixed(2)}<br/>
        <strong>Anomaly Score:</strong> ${d.anomaly_score.toFixed(2)}
      `)
      .style("left",(event.pageX+10)+"px")
      .style("top",(event.pageY-20)+"px");
  }).on("mouseout", ()=>{
    resetHighlight();
    tooltip.style("opacity",0);
  });

  clusters.forEach(c=>{
    const row = legendRows[c.id];
    row.on("mouseover", ()=> highlightCluster(c.id))
       .on("mouseout", ()=> resetHighlight());
  });

});