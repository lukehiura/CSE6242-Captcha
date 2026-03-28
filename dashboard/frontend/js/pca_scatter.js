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

  // ---------------- STATE ----------------
  let activeGame = null;
  let activeCluster = null;
  let filteredPoints = [...points];

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
    .attr("viewBox", `0 0 ${width} ${height}`);

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

  // ---------------- RADAR ----------------
  const radarContainer = d3.select("#radar");
  const radarSize = Math.min(
    radarContainer.node().clientWidth,
    radarContainer.node().clientHeight
  );
  const radarRadius = radarSize / 2.5;

  const radarSvg = radarContainer
    .append("svg")
    .attr("viewBox", `-20 -20 ${radarSize+40} ${radarSize+40}`)
    .append("g")
    .attr("transform", `translate(${radarSize/2},${radarSize/2})`);

  const angleSlice = (2*Math.PI)/features.length;

  // radar grid
  for (let i = 1; i <= 4; i++) {
    radarSvg.append("circle")
      .attr("r", radarRadius * (i/4))
      .attr("fill","none")
      .attr("stroke","#ccc")
      .attr("stroke-dasharray","2,2");
  }

  features.forEach((f,i)=>{
    const angle = i*angleSlice - Math.PI/2;

    radarSvg.append("line")
      .attr("x2", Math.cos(angle)*radarRadius)
      .attr("y2", Math.sin(angle)*radarRadius)
      .attr("stroke","#999");

    radarSvg.append("text")
      .attr("x", Math.cos(angle)*(radarRadius+10))
      .attr("y", Math.sin(angle)*(radarRadius+10))
      .attr("text-anchor","middle")
      .style("font-size","0.75rem")
      .text(f);
  });

  function radarLine(values){
    const scaled = values.map((v,i)=>featureScales[features[i]](v));
    return d3.lineRadial()
      .radius(v=>v*radarRadius)
      .angle((_,i)=>i*angleSlice)([...scaled, scaled[0]]);
  }

  // ---------------- CENTROIDS ----------------
  function computeCentroids(data){
    return d3.rollups(
      data,
      v => ({
        avgZ: features.map(f => d3.mean(v,d=>d[f]))
      }),
      d => d.cluster
    );
  }

  function updateCentroids(){
    const centroids = computeCentroids(filteredPoints);

    const paths = radarSvg.selectAll(".centroid-radar")
      .data(centroids, d=>d[0]);

    paths.exit().remove();

    paths
      .attr("d", d=>radarLine(d[1].avgZ))
      .attr("stroke", d=>colorMap[d[0]])
      .attr("stroke-width",2)
      .attr("opacity",0.5);

    paths.enter()
      .append("path")
      .attr("class","centroid-radar")
      .attr("fill","none")
      .attr("stroke-width",2)
      .attr("stroke", d=>colorMap[d[0]])
      .attr("d", d=>radarLine(d[1].avgZ))
      .attr("opacity",0.5);
  }

  updateCentroids();

  // ---------------- FILTER ----------------
  function applyFilters(){
    filteredPoints = points.filter(d =>
      (!activeGame || d.game_type === activeGame) &&
      (!activeCluster || d.cluster === activeCluster)
    );

    circles.attr("display", d =>
      filteredPoints.includes(d) ? null : "none"
    );

    updateCentroids();
    resetHighlight();
    updateLegendStyles();
    updateGameStyles();
  }

  // ---------------- HOVER ----------------
  function applyHover(clusterId, point=null){

    circles.attr("opacity", d =>
      (filteredPoints.includes(d) && d.cluster === clusterId) ? 1 :
      (filteredPoints.includes(d) ? 0.1 : 0)
    );

    radarSvg.selectAll(".centroid-radar")
      .attr("opacity", d => d[0] === clusterId ? 1 : 0.1)
      .attr("stroke-width", d => d[0] === clusterId ? 3 : 2);

    radarSvg.selectAll(".point-radar").remove();

    if (point){
      radarSvg.append("path")
        .attr("class","point-radar")
        .attr("d", radarLine(features.map(f=>point[f])))
        .attr("fill", colorMap[clusterId])
        .attr("stroke", colorMap[clusterId])
        .attr("opacity",0.4);
    }
  }

  function resetHighlight(){
    circles.attr("opacity",0.4);

    radarSvg.selectAll(".centroid-radar")
      .attr("opacity",0.5)
      .attr("stroke-width",2);

    radarSvg.selectAll(".point-radar").remove();
  }

  // ---------------- TOOLTIP ----------------
  const tooltip = d3.select("#tooltip");

  circles.on("mouseover",(event,d)=>{
    applyHover(d.cluster, d);

    tooltip.style("opacity",1)
      .html(`<strong>Cluster:</strong> ${d.cluster}<br/>
             <strong>Game:</strong> ${d.game_type}`)
      .style("left",(event.pageX+10)+"px")
      .style("top",(event.pageY-20)+"px");
  })
  .on("mouseout",()=>{
    resetHighlight();
    tooltip.style("opacity",0);
  });

  // ---------------- LEGEND ----------------
  const legend = d3.select("#legend");
  const legendRows = {};

  clusters.forEach(c=>{
    const row = legend.append("div").style("cursor","pointer");
    legendRows[c.id] = row;

    row.append("span")
      .style("background",colorMap[c.id])
      .style("width","12px")
      .style("height","12px")
      .style("display","inline-block")
      .style("margin-right","6px");

    row.append("span")
      .attr("class","label")
      .text(clusterNames[c.id]);

    row.on("mouseover", ()=> applyHover(c.id))
       .on("mouseout", ()=> resetHighlight())
       .on("click",(event)=>{
          event.stopPropagation();
          activeCluster = activeCluster === c.id ? null : c.id;
          applyFilters();
       });
  });

  function updateLegendStyles(){
    Object.entries(legendRows).forEach(([id,row])=>{
      row.select(".label")
        .style("font-weight", activeCluster==id ? "bold":"normal")
        .style("color", activeCluster==id ? colorMap[id]:"#000");
    });
  }

  // ---------------- GAME FILTER ----------------
  const gameFilter = d3.select("#game-filter");
  const gameRows = {};
  const gameTypes = [...new Set(points.map(d=>d.game_type))];

  gameTypes.forEach(g=>{
    const row = gameFilter.append("div")
      .attr("class","game-row");

    gameRows[g] = row;

    row.append("span")
      .attr("class","label")
      .text(g);

    row.on("click",(event)=>{
      event.stopPropagation();
      activeGame = activeGame === g ? null : g;
      applyFilters();
    });
  });

  function updateGameStyles(){
    Object.entries(gameRows).forEach(([g,row])=>{
      row.select(".label")
        .style("font-weight", activeGame===g ? "bold":"normal");
    });
  }

  // ---------------- RESET ----------------
  d3.select("body").on("click", ()=>{
    activeGame = null;
    activeCluster = null;
    filteredPoints = [...points];

    circles.attr("display", null);

    updateCentroids();
    resetHighlight();
    updateLegendStyles();
    updateGameStyles();
  });

});