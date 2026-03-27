Promise.all([
  d3.json("data/scatter_points.json"),
  d3.json("data/cluster_meta.json")
]).then(([points, clusters]) => {

  const width = 600, height = 600;
  const margin = {top:60, right:60, bottom:60, left:60};
  const radarSize = 350;
  const radarRadius = 130;
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
  const extent = d3.extent([...points.map(d=>d.pca_x), ...points.map(d=>d.pca_y)]);
  const x = d3.scaleLinear().domain(extent).range([margin.left, width-margin.right]);
  const y = d3.scaleLinear().domain(extent).range([height-margin.bottom, margin.top]);

  const svg = d3.select("#scatter-plot")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

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
  const radarSvg = d3.select("#radar")
    .append("svg")
    .attr("width", radarSize)
    .attr("height", radarSize)
    .append("g")
    .attr("transform", `translate(${radarSize/2},${radarSize/2})`);

  const angleSlice = (2*Math.PI)/features.length;

  // Radar rings
  const ringCount = 4;
  for(let i=1;i<=ringCount;i++){
    radarSvg.append("circle")
      .attr("r", radarRadius*(i/ringCount))
      .attr("fill","none")
      .attr("stroke","#ccc")
      .attr("stroke-dasharray","2,2")
      .attr("opacity",0.5);
  }

  // Radar axes
  features.forEach((f,i)=>{
    const angle = i*angleSlice - Math.PI/2;
    radarSvg.append("line")
      .attr("x1",0).attr("y1",0)
      .attr("x2", Math.cos(angle)*radarRadius)
      .attr("y2", Math.sin(angle)*radarRadius)
      .attr("stroke","#999")
      .attr("stroke-width",1);
    radarSvg.append("text")
      .attr("x", Math.cos(angle)*(radarRadius+10))
      .attr("y", Math.sin(angle)*(radarRadius+10))
      .attr("text-anchor","middle")
      .attr("alignment-baseline","middle")
      .style("font-size","0.65rem")
      .text(f);
  });

  function radarLine(values){
    const scaled = values.map((v,i)=>featureScales[features[i]](v));
    const closed = [...scaled, scaled[0]];
    return d3.lineRadial()
      .radius(v=>v*radarRadius)
      .angle((_,i)=>i*angleSlice)(closed);
  }

  const centroidPaths = radarSvg.selectAll(".centroid-radar")
    .data(centroids)
    .enter()
    .append("path")
    .attr("class","centroid-radar")
    .attr("d",d=>radarLine(d[1].avgZ))
    .attr("fill","none")
    .attr("stroke",d=>colorMap[d[0]])
    .attr("stroke-width",2)
    .attr("opacity",0.5);

  // ---------------- LEGEND ----------------
  const legend = d3.select("#legend");
  const legendRows = {};
  clusters.forEach(c=>{
    const row = legend.append("div")
      .style("cursor","pointer")
      .style("margin-bottom","4px");
    legendRows[c.id] = row;

    row.append("span")
      .style("display","inline-block")
      .style("width","12px")
      .style("height","12px")
      .style("background",colorMap[c.id])
      .style("margin-right","6px");

    row.append("span")
      .text(clusterNames[c.id])
      .style("font-weight","normal")
      .style("color","#000");
  });

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

  // ---------------- SCATTER POINT HOVER ----------------
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

  // ---------------- LEGEND HOVER ----------------
  clusters.forEach(c=>{
    const row = legendRows[c.id];
    row.on("mouseover", ()=>{
      highlightCluster(c.id);
    }).on("mouseout", ()=>{
      resetHighlight();
    });
  });

});