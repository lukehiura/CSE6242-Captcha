Promise.all([
  d3.json("data/scatter_points.json"),
  d3.json("data/cluster_meta.json")
]).then(([points, clusters]) => {

  console.log("Loaded points:", points.length, "clusters:", clusters.length);

  // ---------------- FEATURES ----------------
  const features = ["speed_mean","path_efficiency","pause_rate","duration"];

  // ---------------- STATE ----------------
  state = {
    selectedCluster: null,
    hoveredCluster: null,
    selectedGameFilter: null,
    hoveredGameFilter: null,
    hoveredPoint: null
  };

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

  function attachCircleHover(circles) {
    circles.on("mouseover", (event,d) => {
        state.hoveredPoint = d;
        tooltip.html(`
          <b>${clusterNames[d.cluster]} (${d.cluster})</b><br/>
          <b>Game type:</b> ${d.game_type}<br/>
          <b>Speed mean:</b> ${d.speed_mean.toFixed(2)}<br/>
          <b>Path efficiency:</b> ${d.path_efficiency.toFixed(2)}<br/>
          <b>Pause rate:</b> ${d.pause_rate.toFixed(2)}<br/>
          <b>Duration:</b> ${d.duration.toFixed(2)}<br/>
          <b>Anomaly score:</b> ${d.anomaly_score.toFixed(2)}
        `);
        tooltip.style("opacity",1);
        updateVisuals();
    })
    .on("mousemove", (event) => {
        tooltip.style("left", (event.pageX + 10) + "px")
               .style("top", (event.pageY - 20) + "px");
    })
    .on("mouseout", () => {
        state.hoveredPoint = null;
        tooltip.style("opacity",0);
        updateVisuals();
    });
  }

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
    .attr("opacity", 0.4)
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
      .text(f);
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

  // ---------------- LEGEND ----------------
  const squareSize = 12;
  const textGap = 6;
  const fontSize = 12;
  const legendItemSpacingY = fontSize*1.5;

  const tempText = svg.append("text")
    .attr("class","legend-text-temp")
    .style("font-size",`${fontSize}px`)
    .attr("visibility","hidden");

  const maxTextWidth = d3.max(clusters.map(c=>{
    tempText.text(clusterNames[c.id]);
    return tempText.node().getBBox().width;
  }));
  tempText.remove();

  const legendWidth = squareSize + textGap + maxTextWidth;
  const legendHeight = clusters.length*legendItemSpacingY;

  const pcaLegendGroup = svg.append("g")
    .attr("class","pca-legend")
    .attr("transform",`translate(${width-margin.right-legendWidth},${height-margin.bottom-legendHeight})`);

  clusters.forEach((c,i)=>{
    const g = pcaLegendGroup.append("g")
      .datum(c)
      .attr("class","legend-item")
      .attr("data-cluster",c.id)
      .attr("transform",`translate(0,${i*legendItemSpacingY})`)
      .style("cursor","pointer");

    g.append("rect")
      .attr("width", squareSize)
      .attr("height", squareSize)
      .attr("x",0)
      .attr("y",-squareSize/2)
      .attr("fill", colorMap[c.id]);

    g.append("text")
      .text(clusterNames[c.id])
      .attr("x", squareSize+textGap)
      .attr("y",0)
      .attr("dominant-baseline","middle")
      .style("font-weight","normal")
      .style("fill","#111");

    g.on("mouseover", () => {
      state.hoveredPoint = null;
      state.hoveredCluster = c.id;
      updateVisuals();
      updateLegendAppearance();
    })
    .on("mouseout", () => {
      state.hoveredCluster = null;
      updateVisuals();
      updateLegendAppearance();
    })
    .on("click", () => {
      state.selectedCluster = state.selectedCluster === c.id ? null : c.id;
      applyFilter();
      updateLegendAppearance();
    });
  });

  function updateLegendAppearance() {
    pcaLegendGroup.selectAll(".legend-item").each(function(d) {
      const g = d3.select(this);
      const isHovered = state.hoveredPoint?.cluster === d.id || state.hoveredCluster === d.id;
      const isSelected = state.selectedCluster === d.id;

      g.select("rect")
        .attr("stroke", isSelected ? "#000" : (isHovered ? "#555" : "#999"))
        .attr("stroke-width", isSelected ? 4 : (isHovered ? 3 : 2));

      g.select("text")
        .style("font-weight", isSelected || isHovered ? "bold" : "normal")
        .style("fill", isSelected ? "#000" : (isHovered ? "#555" : "#111"));
    });
  }

  // ---------------- GAME FILTERS ----------------
  const filterDiv = document.getElementById("filter-container");
  const fWidth = filterDiv.clientWidth;
  const fHeight = filterDiv.clientHeight;
  const fMargin = {top:5,right:5,bottom:5,left:5};
  const innerW = fWidth - fMargin.left - fMargin.right;
  const innerH = fHeight - fMargin.top - fMargin.bottom;

  const gameFilters = [
    { id:"sheep", label:"Sheep Herding", svgPath: svgIcons.sheep, game_type:"sheep-herding" },
    { id:"thread", label:"Thread the Needle", svgPath: svgIcons.thread, game_type:"thread-the-needle" },
    { id:"polygon", label:"Polygon Stacking", svgPath: svgIcons.polygon, game_type:"polygon-stacking" }
  ];

  const filterSvg = d3.select("#filter-container")
    .append("svg")
    .attr("width","100%")
    .attr("height","100%")
    .attr("viewBox",`0 0 ${fWidth} ${fHeight}`)
    .attr("preserveAspectRatio","xMidYMid meet");

  const filterGroup = filterSvg.append("g")
    .attr("transform",`translate(${fMargin.left},${fMargin.top})`);

  const itemHeight = innerH / gameFilters.length;
  const circleRadius = Math.min(itemHeight*0.35, innerW*0.2);

  const filterItems = filterGroup.selectAll(".filter-item")
    .data(gameFilters)
    .enter()
    .append("g")
    .attr("class","filter-item")
    .attr("transform",(d,i)=>`translate(${innerW*0.3},${i*itemHeight+itemHeight/2})`)
    .style("cursor","pointer")
    .on("click",(event,d)=>{
      state.selectedGameFilter = state.selectedGameFilter===d.id?null:d.id;
      updateFilterSelection();
      applyFilter();
      updateLegendAppearance();
    })
    .on("mouseover",(event,d)=>{ state.hoveredGameFilter=d.id; updateVisuals(); updateLegendAppearance(); })
    .on("mouseout",(event,d)=>{ state.hoveredGameFilter=null; updateVisuals(); updateLegendAppearance(); });

  filterItems.append("circle")
    .attr("r",circleRadius)
    .attr("fill","#f0f0f0")
    .attr("stroke","#999")
    .attr("stroke-width",2);

  filterItems.append("g").attr("class","icon-wrapper")
    .each(function(d){
      const g = d3.select(this);
      g.html(svgIcons[d.id]);
      const bbox = g.node().getBBox();
      const scale = (circleRadius*1.2)/Math.max(bbox.width,bbox.height);
      g.attr("transform",`translate(${-bbox.x*scale-bbox.width*scale/2},${-bbox.y*scale-bbox.height*scale/2}) scale(${scale})`);
    });

  filterItems.append("text")
    .attr("x",circleRadius+10)
    .attr("y",0)
    .attr("dominant-baseline","middle")
    .text(d=>d.label);

  function updateFilterSelection(){
    filterItems.select("circle").attr("stroke",d=>d.id===state.selectedGameFilter?"#000":"#999")
      .attr("stroke-width",d=>d.id===state.selectedGameFilter?4:2);
    filterItems.select("text").style("font-weight",d=>d.id===state.selectedGameFilter?"bold":"normal");
  }

  // ---------------- APPLY FILTER FUNCTION ----------------
  function applyFilter(){
    console.log("applyFilter called. Selected cluster:", state.selectedCluster, "Game filter:", state.selectedGameFilter);
    currentPoints = points.filter(d=>{
      const matchesCluster = state.selectedCluster===null || d.cluster===state.selectedCluster;
      const matchesGame = !state.selectedGameFilter || d.game_type===gameFilters.find(f=>f.id===state.selectedGameFilter).game_type;
      return matchesCluster && matchesGame;
    });
    console.log("Filtered points count:", currentPoints.length);

    const circleSel = svg.selectAll("circle").data(currentPoints, d => d.id || (d.pca_x+"-"+d.pca_y));
    circleSel.join(
      enter => enter.append("circle")
        .attr("cx", d=>x(d.pca_x))
        .attr("cy", d=>y(d.pca_y))
        .attr("r",3)
        .attr("fill", d=>colorMap[d.cluster])
        .attr("opacity",1)
        .style("cursor","pointer"),
      update => update
        .transition().duration(200)
        .attr("cx", d=>x(d.pca_x))
        .attr("cy", d=>y(d.pca_y))
        .attr("fill", d=>colorMap[d.cluster])
        .attr("opacity",1),
      exit => exit.transition().duration(200)
        .attr("opacity",0)
        .remove()
    );

    circles = svg.selectAll("circle");
    attachCircleHover(circles);

    centroids = d3.rollups(
      currentPoints,
      v=>({ x:d3.mean(v,d=>d.pca_x), y:d3.mean(v,d=>d.pca_y), avgZ: features.map(f=>d3.mean(v,d=>d[f])) }),
      d=>d.cluster
    );
    console.log("Recomputed centroids:", centroids);

    centroidPaths = radarSvg.selectAll(".centroid-radar")
      .data(centroids, d => d[0])
      .join(
        enter => enter.append("path")
          .attr("class", "centroid-radar")
          .attr("fill", "none")
          .attr("stroke", d => colorMap[d[0]])
          .attr("stroke-width", 2)
          .attr("opacity", 0.5)
          .attr("d", d => radarLine(d[1].avgZ)),
        update => update
          .transition().duration(200)
          .attr("d", d => radarLine(d[1].avgZ))
          .attr("stroke", d => colorMap[d[0]])
          .attr("opacity", 0.5),
        exit => exit.transition().duration(200).remove()
      );

    updateVisuals();
  }

  // ---------------- UPDATE VISUALS FUNCTION ----------------
  function updateVisuals() {

    // ---------------- SCATTER POINTS ----------------
    circles.attr("opacity", d => {
      if (state.selectedCluster !== null && d.cluster !== state.selectedCluster) return 0.1;
      if (state.hoveredPoint && d.cluster !== state.hoveredPoint.cluster) return 0.2;
      if (state.hoveredCluster !== null && d.cluster !== state.hoveredCluster) return 0.2;
      if (state.selectedGameFilter) {
        const gameType = gameFilters.find(f => f.id === state.selectedGameFilter).game_type;
        if (d.game_type !== gameType) return 0.05;
      }
      if (state.hoveredGameFilter) {
        const gameType = gameFilters.find(f => f.id === state.hoveredGameFilter).game_type;
        if (d.game_type !== gameType) return 0.2;
      }
      return 1;
    });

    // ---------------- CENTROIDS OPACITY ----------------
    centroidPaths.attr("opacity", d => {
      if (state.selectedCluster !== null) return d[0] === state.selectedCluster ? 1 : 0.1;
      if (state.hoveredPoint) return d[0] === state.hoveredPoint.cluster ? 1 : 0.2;
      if (state.hoveredCluster !== null) return d[0] === state.hoveredCluster ? 1 : 0.2;
      if (state.hoveredGameFilter) return 0;
      return 0.5;
    });

    // ---------------- RADAR POLYGONS ----------------
    radarSvg.selectAll(".point-radar, .potential-game-radar").remove();

    if (state.hoveredPoint) {
      radarSvg.append("path")
        .attr("class", "point-radar")
        .attr("d", radarLine(features.map(f => state.hoveredPoint[f])))
        .attr("fill", colorMap[state.hoveredPoint.cluster])
        .attr("stroke", colorMap[state.hoveredPoint.cluster])
        .attr("opacity", 0.4)
        .attr("pointer-events", "none");
    } else if (state.hoveredCluster !== null) {
      const hoveredCentroid = centroids.find(c => c[0] === state.hoveredCluster);
      if (hoveredCentroid) {
        radarSvg.append("path")
          .attr("class", "point-radar")
          .attr("d", radarLine(hoveredCentroid[1].avgZ))
          .attr("fill", colorMap[hoveredCentroid[0]])
          .attr("stroke", colorMap[hoveredCentroid[0]])
          .attr("opacity", 0.4)
          .attr("pointer-events", "none");
      }
    } else if (state.hoveredGameFilter) {
      const hoveredGamePoints = currentPoints.filter(
        d => d.game_type === gameFilters.find(f => f.id === state.hoveredGameFilter).game_type
      );

      if (hoveredGamePoints.length) {
        const clustersInGame = d3.group(hoveredGamePoints, d => d.cluster);
        clustersInGame.forEach((pointsInCluster, clusterId) => {
          const avgZ = features.map(f => d3.mean(pointsInCluster, d => d[f]));
          radarSvg.append("path")
            .attr("class", "potential-game-radar")
            .attr("d", radarLine(avgZ))
            .attr("fill", "none")
            .attr("stroke", colorMap[clusterId])
            .attr("stroke-width", 2)
            .attr("opacity", 0.3)
            .attr("pointer-events", "none");
        });
      }
    }
  }

  // ---------------- INITIAL RENDER ----------------
  applyFilter();
});