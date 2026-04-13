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


const trajState = {
  frame: 0,
  paused: false,
  playing: false,
  scrubbing: false,
  ended: false
};