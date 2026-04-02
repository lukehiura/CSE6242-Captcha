// backend url - change if needed
const API_BASE = "http://127.0.0.1:5001";

Promise.all([
  d3.json(`${API_BASE}/api/scatter_points.json`),
  d3.json(`${API_BASE}/api/cluster_meta.json`),
]).then(([points, clusters]) => {

  const width = 600, height = 600;
  const margin = {top:60, right:60, bottom:60, left:60};
  const radarSize = 350;
  const radarRadius = 130;
  const features = ["speed_mean","path_efficiency","pause_rate","duration"];

  // data
  points = points.filter(d => !d.is_outlier);
  points.forEach(d => d.duration = Math.log(d.duration));

  const clusterNames = {
    0: "Fast-Balanced-Fluid",
    1: "Slow-Balanced-Fluid",
    2: "Moderate-Circuitous-Hesitant",
    3: "Moderate-Direct-Fluid"
  };

  const gameTypeLabels = {
    "thread-the-needle": "Thread the needle",
    "sheep-herding": "Sheep herding",
    "polygon-stacking": "Polygon stacking"
  };

  function formatGameType(gt) {
    if (gt == null || gt === "") return "—";
    return gameTypeLabels[gt] || String(gt).replace(/-/g, " ");
  }

  const colorPalette = ["#4daf4a","#377eb8","#ff7f00","#e41a1c"];
  const colorMap = {};
  clusters.forEach((c,i)=> colorMap[c.id] = colorPalette[i]);

  // normalize for radar
  const featureScales = {};
  features.forEach(f => {
    const ext = d3.extent(points, d=>d[f]);
    featureScales[f] = d3.scaleLinear().domain(ext).range([0,1]);
  });

  // main plot
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

  let selectedHfIndex = null;
  const isSel = (d) => selectedHfIndex != null && d.hf_index === selectedHfIndex;

  function paintSelectedDot() {
    circles
      .attr("r", (d) => (isSel(d) ? 7 : 3))
      .attr("stroke", (d) => (isSel(d) ? "#111" : "none"))
      .attr("stroke-width", (d) => (isSel(d) ? 2.5 : 0));
  }

  const circles = svg.selectAll("circle")
    .data(points)
    .enter()
    .append("circle")
    .attr("cx", d=>x(d.pca_x))
    .attr("cy", d=>y(d.pca_y))
    .attr("r", 3)
    .attr("fill", d=>colorMap[d.cluster])
    .attr("opacity", 0.4)
    .attr("stroke", "none")
    .style("cursor", "pointer");

  // cluster centers
  const centroids = d3.rollups(
    points,
    v => ({
      x: d3.mean(v,d=>d.pca_x),
      y: d3.mean(v,d=>d.pca_y),
      avgZ: features.map(f => d3.mean(v,d=>d[f]))
    }),
    d=>d.cluster
  );

  // radar chart
  const radarSvg = d3.select("#radar")
    .append("svg")
    .attr("width", radarSize)
    .attr("height", radarSize)
    .append("g")
    .attr("transform", `translate(${radarSize/2},${radarSize/2})`);

  const angleSlice = (2*Math.PI)/features.length;

  // circles on radar
  const ringCount = 4;
  for(let i=1;i<=ringCount;i++){
    radarSvg.append("circle")
      .attr("r", radarRadius*(i/ringCount))
      .attr("fill","none")
      .attr("stroke","#ccc")
      .attr("stroke-dasharray","2,2")
      .attr("opacity",0.5);
  }

  // lines
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

  // legend
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
  const trajectoryCaption = d3.select("#trajectory-caption");
  const selectionContext = d3.select("#selection-context");

  function setSelectionBanner(d) {
    selectionContext
      .classed("muted", false)
      .html(
        `Selected <span class="game-pill">${formatGameType(d.game_type)}</span> · ` +
          `<strong>${d.cluster_name}</strong> · hf_index ${d.hf_index ?? "—"}`
      );
  }

  // draw mouse path in the box on the right
  function renderTrajectory(ticks, hfIndex, gameTypeRaw) {
    const container = d3.select("#trajectory");
    container.selectAll("*").remove();
    if (!ticks || ticks.length === 0) {
      container.append("p").style("font-size", "0.75rem").text("No tick data.");
      trajectoryCaption.html(
        `<strong>Game:</strong> ${formatGameType(gameTypeRaw)} &nbsp;|&nbsp; <strong>Session:</strong> ${hfIndex} — no ticks`
      );
      return;
    }

    const tw = 320, th = 280, pad = 12;
    const xExt = d3.extent(ticks, t => t.x);
    const yExt = d3.extent(ticks, t => t.y);
    const tx = d3.scaleLinear().domain(xExt).range([pad, tw - pad]);
    const ty = d3.scaleLinear().domain(yExt).range([th - pad, pad]);

    const svgT = container.append("svg").attr("width", tw).attr("height", th);

    const line = d3.line()
      .x(t => tx(t.x))
      .y(t => ty(t.y));

    svgT.append("path")
      .datum(ticks)
      .attr("d", line)
      .attr("fill", "none")
      .attr("stroke", "#888")
      .attr("stroke-width", 1.2)
      .attr("opacity", 0.75);

    svgT.selectAll("circle.down")
      .data(ticks.filter(t => t.isDown))
      .enter()
      .append("circle")
      .attr("class", "down")
      .attr("cx", t => tx(t.x))
      .attr("cy", t => ty(t.y))
      .attr("r", 2.5)
      .attr("fill", "#111");

    const g = formatGameType(gameTypeRaw);
    trajectoryCaption.html(
      `<strong>Game:</strong> ${g} &nbsp;|&nbsp; <strong>Session:</strong> ${hfIndex} &nbsp;|&nbsp; ` +
        `${ticks.length} samples <span style="opacity:.75">(dots = mouse down)</span>`
    );
  }

  function highlightCluster(clusterId){
    circles.attr("opacity", d => {
      if (isSel(d)) return 1;
      return d.cluster === clusterId ? 1 : 0.1;
    });
    paintSelectedDot();
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
    circles.attr("opacity", o => {
      if (isSel(o)) return 1;
      return o.cluster === point.cluster ? 1 : 0.1;
    });
    paintSelectedDot();
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
    circles.attr("opacity", d => (isSel(d) ? 1 : 0.4));
    paintSelectedDot();
    centroidPaths.attr("opacity",0.5);
    radarSvg.selectAll(".point-radar").remove();
    Object.values(legendRows).forEach(r => r.select("span:nth-child(2)").style("font-weight","normal").style("color","#000"));
  }

  // hover tooltip
  circles.on("mouseover", (event,d)=>{
    highlightPoint(d);
    tooltip.style("opacity",1)
      .html(`
        <strong>Game:</strong> ${formatGameType(d.game_type)}<br/>
        <strong>Cluster:</strong> ${d.cluster_name} (${d.cluster})<br/>
        <strong>hf_index:</strong> ${d.hf_index ?? "—"}<br/>
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

  // click dot -> ask flask for ticks
  circles.on("click", (event, d) => {
    event.stopPropagation();
    if (d.hf_index == null) {
      console.log("no hf_index in json, rerun notebook");
      return;
    }
    selectedHfIndex = d.hf_index;
    highlightPoint(d);
    setSelectionBanner(d);
    trajectoryCaption.html(
      `<strong>Game:</strong> ${formatGameType(d.game_type)} — loading session <strong>${d.hf_index}</strong>…`
    );
    d3.select("#trajectory").selectAll("*").remove();

    fetch(`${API_BASE}/session/${d.hf_index}`)
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
          `<strong>Game:</strong> ${formatGameType(d.game_type)} — ` +
            `could not load session (Flask on ${API_BASE}?)`
        );
        d3.select("#trajectory").append("p")
          .style("font-size", "0.75rem")
          .style("padding", "8px")
          .text(String(err.message || err));
      });
  });

  // legend hover
  clusters.forEach(c=>{
    const row = legendRows[c.id];
    row.on("mouseover", ()=>{
      highlightCluster(c.id);
    }).on("mouseout", ()=>{
      resetHighlight();
    });
  });

}).catch(err => {
  console.log("dashboard data fetch failed", err);
  d3.select("#scatter-plot")
    .append("p")
    .style("padding", "16px")
    .text("Start Flask on port 5001 (uv run python dashboard/backend/app.py) — JSON is served from dashboard/data/, not duplicated under frontend/data/.");
});