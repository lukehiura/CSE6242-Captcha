const API_BASE =
  typeof window !== "undefined" && typeof window.DASHBOARD_API_BASE === "string"
    ? window.DASHBOARD_API_BASE
    : "";

const FEATURES = [
  "speed_mean",
  "path_efficiency",
  "pause_rate",
  "duration",
  "path_length",
  "speed_std",
];

const CLUSTER_NAMES = {
  0: "Fast-Balanced-Fluid",
  1: "Slow-Balanced-Fluid",
  2: "Moderate-Direct-Fluid",
  3: "Moderate-Circuitous-Hesitant",
};

const CLUSTER_COLORS = [
  "#f77189",
  "#97a431",
  "#36ada4",
  "#a48cf4",
];

const GAME_FILTERS = [
  { id: "sheep", label: "Sheep Herding", game_type: "sheep-herding" },
  { id: "thread", label: "Thread the Needle", game_type: "thread-the-needle" },
  { id: "polygon", label: "Polygon Stacking", game_type: "polygon-stacking" },
];

const GAME_ID_TO_TYPE = Object.fromEntries(GAME_FILTERS.map(f => [f.id, f.game_type]));
const GAME_TYPE_TO_ID = Object.fromEntries(GAME_FILTERS.map(f => [f.game_type, f.id]));

const SCATTER_SELECTED_OPACITY = 0.5;
const SCATTER_UNSELECTED_OPACITY = 0.02;
const SCATTER_PREVIEW_OPACITY = 0.15;
const SCATTER_SELECTED_R = 3;
const SCATTER_SELECTED_STROKE = "#fff";
const SCATTER_SELECTED_STROKE_W = 1.5;

const RADAR_STROKE_WIDTH = 1.2;
const RADAR_STROKE_OPACITY = 0.7;
const RADAR_HOVER_FILL_OPY = 0.8;
const RADAR_HOVER_STROKE_W = 0.1;
const RADAR_PREVIEW_OPACITY = 0.15;

const TRANSITION_MS = 350;
const HOVER_IN_MS = 80;
const HOVER_OUT_MS = 220;
const TRANSITION_EASE = d3.easeCubicOut;

const MAX_HOVER_DIST = 15 * 15; // squared distance

const RADAR_LABELS = {
  speed_mean: "speed",
  path_efficiency: "eff",
  pause_rate: "pause",
  duration: "dur",
  path_length: "len",
  speed_std: "σ spd",
};