// backend url - change if needed
const API_BASE = "http://127.0.0.1:5001";

Promise.all([
  d3.json(`${API_BASE}/api/scatter_points.json`),
  d3.json(`${API_BASE}/api/cluster_meta.json`),
]).then(([points, clusters]) => {

  console.log("Loaded points:", points.length, "clusters:", clusters.length);

  // ---------------- FEATURES ----------------
  const features = ["speed_mean","path_efficiency","pause_rate","duration"];

  // ---------------- STATE ----------------
  
state = {
  selectedClusters: new Set(), // can hold multiple clusters
  selectedGames: new Set(),    // can hold multiple games
  hoveredCluster: null,        // still only one hovered at a time
  hoveredGame: null,           // still only one hovered at a time
  hoveredPoint: null
};


function resetAll() {
  state.selectedClusters.clear();
  state.selectedGames.clear();
  state.hoveredCluster = null;
  state.hoveredGame = null;
  state.hoveredPoint = null;

  applyFilter();
  updateLegendAppearance();   // <-- resets cluster labels
  updateFilterAppearance();   // <-- resets game labels
  updateVisuals();
}

// ---------------- OPACITY CONSTANTS ----------------
const SCATTER_PREVIEW_OPACITY = 0.2;
const SCATTER_SELECTED_OPACITY = .7;
const SCATTER_UNSELECTED_OPACITY = 0.01;

const RADAR_HOVER_OPACITY = 0.2;
const RADAR_SELECTED_OPACITY = 0.7;
const RADAR_UNSELECTED_OPACITY = 0.01;
const TRANSITION_DURATION = 300;

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

  const colorPalette = ["#4daf4a","#377eb8","#ff7f00","#e41a1c"];
  const colorMap = {};
  clusters.forEach((c,i)=> colorMap[c.id] = colorPalette[i]);

  // ---------------- FEATURE NORMALIZATION ----------------
  const featureScales = {};
  features.forEach(f => {
    const ext = d3.extent(currentPoints, d => d[f]);
    featureScales[f] = d3.scaleLinear().domain(ext).range([0,1]);
  });

  // ---------------- PCA SCALES ----------------
  const scatterDiv = document.getElementById("scatter-plot");
  const width = scatterDiv.clientWidth;
  const height = scatterDiv.clientHeight;
  const margin = {top:50, right:50, bottom:50, left:50};

  const extent = d3.extent([...currentPoints.map(d=>d.pca_x), ...currentPoints.map(d=>d.pca_y)]);
  const x = d3.scaleLinear().domain(extent).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain(extent).range([height - margin.bottom, margin.top]);

  const xCenter = margin.left + (width - margin.left - margin.right)/2;
  const yCenter = margin.top + (height - margin.top - margin.bottom)/2;
  const labelDistFromAxes = 2*margin.left/3;

  const svg = d3.select("#scatter-plot")
    .append("svg")
    .attr("width","100%")
    .attr("height","auto")
    .attr("viewBox",`0 0 ${width} ${height}`)
    .attr("preserveAspectRatio","xMidYMin meet");
	
svg.on("click", function(event) {

  const clickedCircle = event.target.tagName === "circle";
  const clickedLegend = event.target.closest(".pca-legend");

  // ignore clicks on points OR legend
  if (clickedCircle || clickedLegend) return;

  resetAll();
});


  // ---------------- TOOLTIP ----------------
  const tooltip = d3.select("body").append("div")
    .attr("id","tooltip")
    .style("position","absolute")
    .style("pointer-events","none")
    .style("opacity",0)
    .style("z-index",9999)
    .style("background","rgba(0,0,0,0.7)")
    .style("color","white")
    .style("padding","6px")
    .style("border-radius","4px")
    .style("font-size","0.85rem")
    .style("transition","opacity 0.15s")
    .style("display","inline-block")
    .style("white-space","normal")
    .style("max-width","250px");



  // ---------------- AXES ----------------
  svg.append("g")
    .attr("transform",`translate(0,${height-margin.bottom})`)
    .call(d3.axisBottom(x));

  svg.append("g")
    .attr("transform",`translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  svg.append("text")
    .attr("x", xCenter)
    .attr("y", height - margin.bottom + labelDistFromAxes)
    .attr("text-anchor","middle")
    .attr("dominant-baseline","middle")
    .style("font-size","16px")
    .style("font-weight","bold")
    .text("PC1");

  svg.append("text")
    .attr("transform", `translate(${margin.left - labelDistFromAxes}, ${yCenter}) rotate(-90)`)
    .attr("text-anchor","middle")
    .attr("dominant-baseline","middle")
    .style("font-size","16px")
    .style("font-weight","bold")
    .text("PC2");

  // ---------------- SCATTER POINTS ----------------
  let circles = svg.selectAll("circle")
    .data(currentPoints, d => d.id || (d.pca_x + "-" + d.pca_y))
    .enter()
    .append("circle")
    .attr("cx", d => x(d.pca_x))
    .attr("cy", d => y(d.pca_y))
    .attr("r", 3)
    .attr("fill", d => colorMap[d.cluster])
    .attr("opacity", SCATTER_SELECTED_OPACITY)
    .style("cursor","pointer");

  attachCircleHover(circles);

  // ---------------- RADAR ----------------
  const radarContainer = d3.select("#radar");
  const wrapperWidth = radarContainer.node().clientWidth;
  const wrapperHeight = radarContainer.node().clientHeight;
  const radarMargin = {top:20,right:45,bottom:70,left:45};
  const innerWidth = wrapperWidth - radarMargin.left - radarMargin.right;
  const innerHeight = wrapperHeight - radarMargin.top - radarMargin.bottom;
  const radarSize = Math.min(innerWidth, innerHeight);
  const radarRadius = radarSize/2;
  const offsetX = radarMargin.left + (innerWidth - radarSize)/2;
  const offsetY = radarMargin.top + (innerHeight - radarSize)/2;

  const radarSvgRoot = radarContainer.append("svg")
    .attr("width","100%")
    .attr("height","100%")
    .attr("viewBox",`0 0 ${wrapperWidth} ${wrapperHeight}`)
    .attr("preserveAspectRatio","xMidYMid meet");

  const radarSvg = radarSvgRoot.append("g")
    .attr("transform",`translate(${offsetX+radarRadius},${offsetY+radarRadius})`);

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

  const angleSlice = 2*Math.PI/features.length;
  const ringCount = 4;
  for(let i=1;i<=ringCount;i++){
    radarSvg.append("circle")
      .attr("r", radarRadius*(i/ringCount))
      .attr("fill","none")
      .attr("stroke","#ccc")
      .attr("stroke-dasharray","2,2");
  }

  features.forEach((f,i)=>{
    const angle = i*angleSlice - Math.PI/2;
    radarSvg.append("line")
      .attr("x1",0).attr("y1",0)
      .attr("x2", Math.cos(angle)*radarRadius)
      .attr("y2", Math.sin(angle)*radarRadius)
      .attr("stroke","#999");
    radarSvg.append("text")
      .attr("x", Math.cos(angle)*(radarRadius+12))
      .attr("y", Math.sin(angle)*(radarRadius+12))
      .attr("text-anchor","middle")
      .attr("alignment-baseline","middle")
      .text(f)
	  .attr("class", "legend-text");
  });

  function radarLine(values){
    const scaled = values.map((v,i)=>featureScales[features[i]](v));
    const closed = [...scaled, scaled[0]];
    return d3.lineRadial()
      .radius(v=>v*radarRadius)
      .angle((_,i)=>i*angleSlice)(closed);
  }

  // ---------------- CENTROIDS ----------------
  let centroids = d3.rollups(
    currentPoints,
    v => ({
      x: d3.mean(v,d=>d.pca_x),
      y: d3.mean(v,d=>d.pca_y),
      avgZ: features.map(f=>d3.mean(v,d=>d[f]))
    }),
    d => d.cluster
  );

  let centroidPaths = radarSvg.selectAll(".centroid-radar")
    .data(centroids, d=>d[0])
    .join(
      enter => enter.append("path")
        .attr("class","centroid-radar")
        .attr("fill","none")
        .attr("stroke", d => colorMap[d[0]])
        .attr("stroke-width", 2)
        .attr("opacity", 0.5)
        .attr("d", d => radarLine(d[1].avgZ))
    );

//////////////////////////
// PERSISTENT RADAR PATH //
//////////////////////////
const hoveredRadarPath = radarSvg.append("path")
  .attr("class", "point-radar")
  .attr("fill", "none")
  .attr("stroke-width", 2)
  .attr("pointer-events", "none")
  .style("opacity", 0); // start hidden

let selectedHfIndex = null;
const isSel = (d) => selectedHfIndex != null && d.hf_index === selectedHfIndex;

// ------------------ HF SELECTION FUNCTION ------------------
function selectHfIndex(hfIndex) { // <-- HF selection integration
  const point = points.find(d => d.hf_index === hfIndex);
  if (!point) {
    console.warn("HF index not found:", hfIndex);
    return;
  }
  selectedHfIndex = hfIndex;
  highlightPoint(point);
  setSelectionBanner(point);

  trajectoryCaption.html(
    `<strong>Game:</strong> ${formatGameType(point.game_type)} — loading session <strong>${hfIndex}</strong>…`
  );
  d3.select("#trajectory").selectAll("*").remove();

  fetch(`${API_BASE}/session/${hfIndex}`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(session => {
      renderTrajectory(session.ticks, session.hf_index, session.game_type);
    })
    .catch(err => {
      console.log("fetch broke", err);
      trajectoryCaption.html(
        `<strong>Game:</strong> ${formatGameType(point.game_type)} — could not load session`
      );
      d3.select("#trajectory").append("p")
        .style("font-size", "0.75rem")
        .style("padding", "8px")
        .text(String(err.message || err));
    });
}
// ---------------- END HF SELECTION FUNCTION ------------------


//////////////////////////
// ATTACH HOVER TO CIRCLES
//////////////////////////
function attachCircleHover(circles) {
  let tooltipTimeout;

  circles.on("mouseover", function(event, d) {
      const opacity = +d3.select(this).style("opacity");
      if (opacity < 0.1) return; // ignore invisible points only

      if (tooltipTimeout) clearTimeout(tooltipTimeout);
      state.hoveredPoint = d;

      // ---------------- TOOLTIP ----------------
      tooltip.html(`
	    <b>Index:</b> ${d.hf_index}<br/>
        <b>${clusterNames[d.cluster]} (${d.cluster})</b><br/>
        <b>Game type:</b> ${d.game_type}<br/>
        <b>Speed mean:</b> ${d.speed_mean.toFixed(2)}<br/>
        <b>Path efficiency:</b> ${d.path_efficiency.toFixed(2)}<br/>
        <b>Pause rate:</b> ${d.pause_rate.toFixed(2)}<br/>
        <b>Duration:</b> ${d.duration.toFixed(2)}<br/>
        <b>Anomaly score:</b> ${d.anomaly_score.toFixed(2)}
      `);
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
  .on("click", function(event, d) {
      if (d.hf_index != null) { selectHfIndex(d.hf_index); }
  });  
  ;
}

// ---------------- LEGEND ----------------
// create a temporary SVG text element to read CSS font size
const tempDom = document.createElementNS("http://www.w3.org/2000/svg", "text");
tempDom.setAttribute("class", "filters-text");
document.body.appendChild(tempDom);
const computedFontSize = parseFloat(window.getComputedStyle(tempDom).fontSize);
document.body.removeChild(tempDom);

const fontSize = computedFontSize;
const legendItemSpacingY = fontSize * 1.5;
const squareSize = computedFontSize;
const textGap = computedFontSize / 2;

// measure max text width
const tempText = svg.append("text")
  .attr("class", "legend-text-temp filters-text")
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
  .attr("transform", `translate(${width - margin.right - legendWidth},${height - margin.bottom - legendHeight})`);

const legendItems = pcaLegendGroup.selectAll(".legend-item")
  .data(clusters)
  .join("g")
  .attr("class", "legend-item")
  .attr("data-cluster", d => d.id)
  .attr("transform", (d,i) => `translate(0,${i * legendItemSpacingY})`)
  .style("cursor", "pointer")
  .on("mouseover", (event,d) => {
      state.hoveredPoint = null;
      state.hoveredCluster = d.id;
      state.hoveredGame = null;
      updateLegendAppearance();
      applyFilter(); // recompute points for hover preview
  })
  .on("mouseout", (event,d) => {
      state.hoveredCluster = null;
      updateLegendAppearance();
      applyFilter(); // recompute points after hover ends
  })
  .on("click", (event,d) => {
      if(state.selectedClusters.has(d.id)) state.selectedClusters.delete(d.id);
      else state.selectedClusters.add(d.id);

      // auto-clear if all clusters are selected
      if(state.selectedClusters.size === clusters.length) state.selectedClusters.clear();
	  
	  // IMMEDIATELY clear hovered state on click
      state.hoveredGame = null;  
      state.hoveredCluster = null;

      updateLegendAppearance();
      applyFilter();
  });

// add rects
legendItems.append("rect")
  .attr("width", squareSize)
  .attr("height", squareSize)
  .attr("x", 0)
  .attr("y", -squareSize/2)
  .attr("fill", d => colorMap[d.id]);

// add text
legendItems.append("text")
  .text(d => clusterNames[d.id])
  .attr("x", squareSize + textGap)
  .attr("y", 0)
  .attr("dominant-baseline", "middle")
  .attr("class", "filters-text");

function updateLegendAppearance() {
  pcaLegendGroup.selectAll(".legend-item").each(function(d) {
    const g = d3.select(this);

    const isHovered = state.hoveredCluster === d.id;
    const isSelected = state.selectedClusters.has(d.id);

    g.select("rect")
      .attr("stroke", isSelected ? "#000" : (isHovered ? "#555" : "#999"))
      .attr("stroke-width", isSelected ? 3 : (isHovered ? 2 : 1));

    // CLEAR then SET classes
    const text = g.select("text.filters-text");
    text.classed("selected", false)
        .classed("hovered", false)
        .classed("selected", isSelected)
        .classed("hovered", isHovered);
  });
}

// ---------------- GAME FILTERS ----------------
const filterDiv = document.getElementById("filter-container");
const fWidth = filterDiv.clientWidth;
const fHeight = filterDiv.clientHeight;
const fMargin = { top: 5, right: 5, bottom: 5, left: 5 };
const innerW = fWidth - fMargin.left - fMargin.right;
const innerH = fHeight - fMargin.top - fMargin.bottom;

const gameFilters = [
  { id: "sheep", label: "Sheep Herding", svgPath: svgIcons.sheep, game_type: "sheep-herding" },
  { id: "thread", label: "Thread the Needle", svgPath: svgIcons.thread, game_type: "thread-the-needle" },
  { id: "polygon", label: "Polygon Stacking", svgPath: svgIcons.polygon, game_type: "polygon-stacking" }
];

const gameTypeToId = {};
gameFilters.forEach(f => gameTypeToId[f.game_type] = f.id);


const filterSvg = d3.select("#filter-container")
  .append("svg")
  .attr("width", "100%")
  .attr("height", "100%")
  .attr("viewBox", `0 0 ${fWidth} ${fHeight}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

const filterGroup = filterSvg.append("g")
  .attr("transform", `translate(${fMargin.left},${fMargin.top})`);

const itemHeight = innerH / gameFilters.length;
const circleRadius = Math.min(itemHeight * 0.35, innerW * 0.2);

const filterItems = filterGroup.selectAll(".filter-item")
  .data(gameFilters)
  .join("g")
  .attr("class", "filter-item")
  .attr("data-filter", d => d.id)
  .attr("transform", (d, i) => `translate(${innerW * 0.3},${i * itemHeight + itemHeight / 2})`)
  .style("cursor", "pointer")
  .on("mouseover", (event, d) => {
      state.hoveredGame = d.id;
      updateFilterAppearance();
      applyFilter(); // preview points
  })
  .on("mouseout", (event, d) => {
      state.hoveredGame = null;
      updateFilterAppearance();
      applyFilter(); // revert preview
  })
.on("click", (event, d) => {
    if (state.selectedGames.has(d.id)) state.selectedGames.delete(d.id);
    else state.selectedGames.add(d.id);

    // auto-clear if all games selected
    if (state.selectedGames.size === gameFilters.length) state.selectedGames.clear();

    // IMMEDIATELY clear hovered state on click
    state.hoveredGame = null;  
    state.hoveredCluster = null;

    updateFilterAppearance(); // update visuals
    applyFilter();             // update points
});

// ---------------- DRAW CIRCLES AND ICONS ----------------
filterItems.append("circle")
  .attr("r", circleRadius)
  .attr("fill", "#f0f0f0")
  .attr("stroke", "#999")
  .attr("stroke-width", 2);

filterItems.append("g").attr("class", "icon-wrapper")
  .each(function(d){
      const g = d3.select(this);
      g.html(svgIcons[d.id]);
      const bbox = g.node().getBBox();
      const scale = (circleRadius * 1.2) / Math.max(bbox.width, bbox.height);
      g.attr("transform", `translate(${-bbox.x*scale-bbox.width*scale/2},${-bbox.y*scale-bbox.height*scale/2}) scale(${scale})`);
  });

filterItems.append("text")
  .attr("x", circleRadius + 10)
  .attr("y", 0)
  .attr("dominant-baseline", "middle")
  .text(d => d.label)
  .attr("class", "filters-text");

// CSS-driven hover / selected styling
function updateFilterAppearance() {
  filterItems.each(function(d) {
    const g = d3.select(this);
    const isHovered = state.hoveredGame === d.id;
    const isSelected = state.selectedGames.has(d.id);

    g.select("circle")
      .attr("stroke", isSelected ? "#000" : (isHovered ? "#555" : "#999"))
      .attr("stroke-width", isSelected ? 4 : (isHovered ? 3 : 2));

    const text = g.select("text.filters-text");
    text.classed("selected", false)
        .classed("hovered", false)
        .classed("selected", isSelected)
        .classed("hovered", isHovered);
  });
}



// ---------------- APPLY FILTER ----------------
function applyFilter() {
  console.log(
    "applyFilter called. Selected clusters:", [...state.selectedClusters],
    "Selected games:", [...state.selectedGames]
  );

  // ---------------- BUILD ACTIVE SETS ----------------
  const activeClusters = new Set([...state.selectedClusters]);
  if (state.hoveredCluster !== null) {
  if (activeClusters.has(state.hoveredCluster)) {
    activeClusters.delete(state.hoveredCluster);
  } else {
    activeClusters.add(state.hoveredCluster);
  }
}

  const activeGameTypes = new Set([...state.selectedGames].map(
    id => gameFilters.find(f => f.id === id)?.game_type
  ));
if (state.hoveredGame !== null) {
  const hoveredType = gameFilters.find(f => f.id === state.hoveredGame)?.game_type;
  if (hoveredType) {
    if (activeGameTypes.has(hoveredType)) {
      activeGameTypes.delete(hoveredType);
    } else {
      activeGameTypes.add(hoveredType);
    }
  }
}

  // ---------------- FILTER POINTS ----------------
  currentPoints = points.filter(d => {
    const clusterMatch = activeClusters.size === 0 || activeClusters.has(d.cluster);
    const gameMatch = activeGameTypes.size === 0 || activeGameTypes.has(d.game_type);
    return clusterMatch && gameMatch;
  });

  console.log("Filtered points count:", currentPoints.length);

  // ---------------- UPDATE SCATTER POINTS ----------------
const circleSel = svg.selectAll("circle")
  .data(currentPoints, d => d.id || (d.pca_x + "-" + d.pca_y));

circleSel.join(
  enter => enter.append("circle")
    .attr("cx", d => x(d.pca_x))
    .attr("cy", d => y(d.pca_y))
    .attr("r", 3)
    .attr("fill", d => colorMap[d.cluster])
    .style("cursor", "pointer")
    .attr("opacity", 0), // start invisible for transition
  update => update,      // keep existing circles
  exit => exit.transition().duration(200)
    .attr("opacity", 0)
    .remove()
);

// After join, always call updateVisuals to handle opacity based on state
circles = svg.selectAll("circle");
attachCircleHover(circles);


  // ---------------- UPDATE CENTROIDS ----------------
  centroids = d3.rollups(
    currentPoints,
    v => ({ 
      x: d3.mean(v, d => d.pca_x), 
      y: d3.mean(v, d => d.pca_y), 
      avgZ: features.map(f => d3.mean(v, d => d[f])) 
    }),
    d => d.cluster
  );

centroidPaths = radarSvg.selectAll(".centroid-radar")
  .data(centroids, d => d[0])
  .join(
    enter => enter.append("path")
      .attr("class", "centroid-radar")
      .attr("fill", "none")
      .attr("stroke", d => colorMap[d[0]])
      .attr("stroke-width", 2)
      .attr("opacity", 0) // start invisible
      .attr("d", d => radarLine(d[1].avgZ)),
    update => update
      .attr("stroke", d => colorMap[d[0]])
      .attr("stroke-width", 2)
      .attr("d", d => radarLine(d[1].avgZ)),
    exit => exit.transition().duration(TRANSITION_DURATION).attr("opacity", 0).remove()
  );

// Let updateVisuals handle opacity
updateVisuals();
}

function updateVisuals() {

  // ---------------- SCATTER POINTS ----------------
  circles.transition().duration(TRANSITION_DURATION)
    .attr("opacity", d => {

      // ---------------- BUILD ACTIVE SETS ----------------
      const activeClusters = new Set([...state.selectedClusters]);
      if (state.hoveredCluster !== null) {
        if (activeClusters.has(state.hoveredCluster)) {
          activeClusters.delete(state.hoveredCluster);
        } else {
          activeClusters.add(state.hoveredCluster);
        }
      }

      const activeGames = new Set([...state.selectedGames]);
      if (state.hoveredGame !== null) {
        if (activeGames.has(state.hoveredGame)) {
          activeGames.delete(state.hoveredGame);
        } else {
          activeGames.add(state.hoveredGame);
        }
      }

      // ---------------- MATCH LOGIC ----------------
      const clusterMatch = activeClusters.size === 0 || activeClusters.has(d.cluster);
      const gameMatch = activeGames.size === 0 || activeGames.has(gameTypeToId[d.game_type]);

      const passes = clusterMatch && gameMatch;

      // ---------------- BASE (NO HOVER) ----------------
      const baseClusterMatch = state.selectedClusters.size === 0 || state.selectedClusters.has(d.cluster);
      const baseGameMatch = state.selectedGames.size === 0 || state.selectedGames.has(gameTypeToId[d.game_type]);

      const basePasses = baseClusterMatch && baseGameMatch;

      // ---------------- PREVIEW DETECTION ----------------
const isPreview = passes !== basePasses;

// Detect "no base selection"
const noBaseSelection =
  state.selectedClusters.size === 0 &&
  state.selectedGames.size === 0;

// ---------------- FINAL OPACITY ----------------
if (passes) {
  // If nothing selected yet → treat preview as SELECTED
  if (noBaseSelection) return SCATTER_SELECTED_OPACITY;

  return isPreview ? SCATTER_PREVIEW_OPACITY : SCATTER_SELECTED_OPACITY;
}

return SCATTER_UNSELECTED_OPACITY;

    });

  // ---------------- RADAR CENTROIDS ----------------
  centroidPaths.transition().duration(TRANSITION_DURATION)
    .attr("opacity", d => {
      if (state.hoveredGame !== null) return RADAR_UNSELECTED_OPACITY;
      if (state.hoveredCluster !== null) {
        return d[0] === state.hoveredCluster ? RADAR_HOVER_OPACITY : RADAR_UNSELECTED_OPACITY;
      }
      if (state.selectedClusters.size > 0) {
        return state.selectedClusters.has(d[0]) ? RADAR_SELECTED_OPACITY : RADAR_UNSELECTED_OPACITY;
      }
      return RADAR_SELECTED_OPACITY;
    });

// ---------------- RADAR PREVIEW (FULL FUTURE STATE) ----------------

// Build ACTIVE sets (same logic as applyFilter)
const activeClusters = new Set([...state.selectedClusters]);
if (state.hoveredCluster !== null) {
  if (activeClusters.has(state.hoveredCluster)) {
    activeClusters.delete(state.hoveredCluster);
  } else {
    activeClusters.add(state.hoveredCluster);
  }
}

const activeGameTypes = new Set(
  [...state.selectedGames].map(id => gameFilters.find(f => f.id === id)?.game_type)
);

if (state.hoveredGame !== null) {
  const hoveredType = gameFilters.find(f => f.id === state.hoveredGame)?.game_type;
  if (hoveredType) {
    if (activeGameTypes.has(hoveredType)) {
      activeGameTypes.delete(hoveredType);
    } else {
      activeGameTypes.add(hoveredType);
    }
  }
}

// Build PREVIEW dataset
const previewPoints = points.filter(d => {
  const clusterMatch = activeClusters.size === 0 || activeClusters.has(d.cluster);
  const gameMatch = activeGameTypes.size === 0 || activeGameTypes.has(d.game_type);
  return clusterMatch && gameMatch;
});

// Compute PREVIEW centroids
const previewCentroids = d3.rollups(
  previewPoints,
  v => ({
    avgZ: features.map(f => d3.mean(v, d => d[f]))
  }),
  d => d.cluster
);

// Draw preview radar
radarSvg.selectAll(".preview-radar")
  .data(previewCentroids, d => d[0])
  .join(
    enter => enter.append("path")
      .attr("class", "preview-radar")
      .attr("fill", "none")
      .attr("stroke", d => colorMap[d[0]])
      .attr("stroke-width", 3)
      .attr("stroke-dasharray", "4,2") // <-- visually distinguish preview
      .attr("opacity", 0)
      .attr("pointer-events", "none")
      .attr("d", d => radarLine(d[1].avgZ))
      .transition().duration(TRANSITION_DURATION)
      .attr("opacity", RADAR_HOVER_OPACITY),

    update => update
      .transition().duration(TRANSITION_DURATION)
      .attr("opacity", RADAR_HOVER_OPACITY)
      .attr("d", d => radarLine(d[1].avgZ)),

    exit => exit
      .transition().duration(TRANSITION_DURATION)
      .attr("opacity", 0)
      .remove()
  );





}

// ---------------- GLOBAL CLICK RESET ----------------
document.addEventListener("click", function(event) {

  const clickedInsideScatter = event.target.closest("#scatter-plot");
  const clickedInsideLegend = event.target.closest(".pca-legend");
  const clickedInsideFilter = event.target.closest("#filter-container");

  // If click is inside ANY interactive component → ignore
  if (clickedInsideScatter || clickedInsideLegend || clickedInsideFilter) {
    return;
  }

  resetAll();
});

document.addEventListener("keydown", function(event) {
  if (event.key === "Escape") {
    resetAll();
  }
});


  // ---------------- INITIAL RENDER ----------------
  applyFilter();
});