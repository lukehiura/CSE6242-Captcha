let filterItems;
let allGameTypes, precomputedCentroids;

function computeClusterCentroids(pts) {
  const groups = d3.group(pts, d => d.cluster);

  return Array.from(groups, ([cluster, members]) => {
    const c = { cluster };
    FEATURES.forEach(f => (c[f] = d3.mean(members, d => d[f])));
    return c;
  });
}

function initFilters(points) {
  allGameTypes = Array.from(new Set(points.map(d => d.game_type)));

  precomputedCentroids = new Map();

  const allKey = JSON.stringify(allGameTypes.slice().sort());
  precomputedCentroids.set(allKey, computeClusterCentroids(points));

  allGameTypes.forEach(gt => {
    const key = JSON.stringify([gt]);
    precomputedCentroids.set(
      key,
      computeClusterCentroids(points.filter(d => d.game_type === gt))
    );
  });

  const filterDiv = document.getElementById("filter-container");
  requestAnimationFrame(() => _buildFilterSvg(filterDiv, points));
}

function _buildFilterSvg(filterDiv, points) {
  const fW = Math.max(filterDiv.clientWidth, 100);
  const fH = Math.max(filterDiv.clientHeight, 200);

  const fm = { top: 5, right: 5, bottom: 5, left: 5 };
  const centerX = fm.left + (fW - fm.left - fm.right) / 2;

  const circleR = Math.min(
    (fW - fm.left - fm.right) / 2,
    (fH - fm.top - fm.bottom) / 2 / 3
  ) * 0.6;

  const filterSvg = d3.select("#filter-container")
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${fW} ${fH}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  filterItems = filterSvg.selectAll(".filter-item")
    .data(GAME_FILTERS, d => d.id)
    .join("g")
    .attr("class", "filter-item")
    .attr("transform", (d, i) =>
      `translate(${centerX}, ${fm.top + circleR + i * circleR * 3.3})`
    );

  filterItems.append("circle")
    .attr("r", circleR);

  filterItems.append("g")
    .attr("class", "icon-wrapper")
    .each(function (d) {
      const g = d3.select(this);

      g.html(svgIcons[d.id]);

      const bb = g.node().getBBox();
      const scale = (circleR * 1.4) / Math.max(bb.width, bb.height);

      g.attr(
        "transform",
        `translate(${-bb.x * scale - bb.width * scale / 2},
                   ${-bb.y * scale - bb.height * scale / 2}) scale(${scale})`
      );
    });

  filterItems.append("text")
    .attr("class", "filters-text")
    .attr("x", 0)
    .attr("y", circleR * 1.2)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "hanging")
    .text(d => d.label);

  filterItems
    .on("mouseover", (event, d) => {
      state.hoveredGame = d.id;
      updateFilterAppearance();
      requestHoverRender();
    })
    .on("mouseout", () => {
      state.hoveredGame = null;
      updateFilterAppearance();
      requestHoverRender();
    })
    .on("click", (event, d) => {
      const idx = GAME_FILTERS.findIndex(f => f.id === d.id);

      const baseT =
        `translate(${centerX}, ${fm.top + circleR + idx * circleR * 3.3})`;

      const el = d3.select(event.currentTarget);

      // 1. stop any existing transitions immediately
      el.interrupt();

      // 2. run bounce FIRST (instant feedback)
      el
        .transition().duration(80)
        .attr("transform", `${baseT} scale(1.18)`)
        .transition().duration(180)
        .ease(d3.easeBounceOut)
        .attr("transform", `${baseT} scale(1)`);

      // 3. THEN update state + heavy work
      state.selectedGame =
        state.selectedGame === d.id ? null : d.id;

      updateFilterAppearance();

      // 4. defer heavy work one frame
      requestAnimationFrame(() => {
        applyFilter();
      });
    });
  updateFilterAppearance();
}

function updateFilterAppearance() {
  if (!filterItems) return;

  filterItems.each(function (d) {
    const g = d3.select(this);

    const isHovered = state.hoveredGame === d.id;
    const isSelected = state.selectedGame === d.id;

    g.classed("is-hovered", isHovered)
      .classed("is-selected", isSelected);


  });
}

function getFilteredCentroids() {
  const activeClusters = state.selectedClusters;

  let centroids;

  if (!state.selectedGame) {
    const key = JSON.stringify(allGameTypes.slice().sort());
    centroids =
      precomputedCentroids.get(key) ||
      computeClusterCentroids(state.points);
  } else {
    const gt = GAME_ID_TO_TYPE[state.selectedGame];
    const key = JSON.stringify([gt]);
    centroids = precomputedCentroids.get(key) || [];
  }

  return activeClusters.size === 0
    ? centroids
    : centroids.filter(c => activeClusters.has(c.cluster));
}

function applyFilter() {
  const activeClusters = state.selectedClusters;

  const activeGameTypes = state.selectedGame
    ? new Set([GAME_ID_TO_TYPE[state.selectedGame]])
    : new Set();

  const centroids = getFilteredCentroids();

  state.clusterCentroids = centroids;

  radarUpdate(centroids);
  scatterApplyFilter(activeClusters, activeGameTypes);
}

let hoverDirty = false;

function requestHoverRender() {
  if (hoverDirty) return;
  hoverDirty = true;
  requestAnimationFrame(renderHover);
}

function renderHover() {
  hoverDirty = false;

  updatePreview();
}

function resetAll() {
  state.selectedClusters.clear();
  state.selectedGame = null;
  state.hoveredCluster = null;
  state.hoveredGame = null;
  state.hoveredPoint = null;
  state.selectedPoint = null;

  if (typeof _trajAbortCtrl !== "undefined" && _trajAbortCtrl) {
    _trajAbortCtrl.abort();
    _trajAbortCtrl = null;
  }

  if (typeof _trajRafId !== "undefined" && _trajRafId) {
    cancelAnimationFrame(_trajRafId);
    _trajRafId = null;
  }

  if (typeof _removeSelectionMarker === "function") {
    _removeSelectionMarker();
  }

  d3.select("#selected-point-info")
    .html("")
    .style("display", "none")
    .classed("tooltip-style", false);

  d3.select("#trajectory-plot").html("");
  d3.select("#trajectory-caption").html("");

  applyFilter();
  updateLegendAppearance();
  updateFilterAppearance();
  updateVisuals();
}