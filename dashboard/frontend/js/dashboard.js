Promise.all([
  d3.json(`${API_BASE}/api/scatter_points.json`),
  d3.json(`${API_BASE}/api/cluster_meta.json`),
]).then(([rawPoints, clusters]) => {

  const points = rawPoints
    .filter(d => !d.is_outlier)
    .map(d => ({ ...d, duration: Math.log(d.duration) }));

  state.points = points;

  initScatter(points, clusters);
  initRadar(points);
  initFilters(points);

  state.clusterCentroids = computeClusterCentroids(points);
  applyFilter();

  const params  = new URLSearchParams(window.location.search);
  const cluster = params.get("cluster");
  const pointId = params.get("point");
  const game    = params.get("game");

  if (cluster !== null) {
    const cId = parseInt(cluster, 10);
    if (!isNaN(cId)) {
      state.selectedClusters.add(cId);
      updateLegendAppearance();
    }
  }
  if (game) {
    const gId = GAME_TYPE_TO_ID[game];
    if (gId) {
      state.selectedGame = gId;
      updateFilterAppearance();
    }
  }
  if (cluster !== null || game) applyFilter();

  if (pointId !== null) {
    const hfIdx = parseInt(pointId, 10);
    const pt    = points.find(p => p.hf_index === hfIdx);
    if (pt) {
      state.selectedPoint = hfIdx;
      d3.select("#selected-point-info")
        .html(buildStatsCardHTML(pt))
        .classed("tooltip-style", false)
        .style("display", "block");
      renderMouseTrajectory(hfIdx, "trajectory-plot", "#trajectory-caption", points);
      updateVisuals();
    }
  }

}).catch(err => {
  d3.select("#scatter-plot")
    .append("p").style("padding", "16px").style("color", "#ccc")
    .text(`Could not load data — is Flask running? (${err.message || err})`);
});
