const state = {
  points:           [],
  selectedClusters: new Set(),
  selectedGame:     null,
  hoveredCluster:   null,
  hoveredGame:      null,
  hoveredPoint:     null,
  selectedPoint:    null,
  clusterCentroids: [],
};

const committedOpacity = new Map();