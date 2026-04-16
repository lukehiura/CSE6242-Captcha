let _trajAbortCtrl = null;
let _trajRafId = null;

function renderMouseTrajectory(hfIndex, targetDivId, captionSelector, scatterPoints) {
  if (_trajAbortCtrl) { _trajAbortCtrl.abort(); _trajAbortCtrl = null; }
  if (_trajRafId) { cancelAnimationFrame(_trajRafId); _trajRafId = null; }

  _trajAbortCtrl = new AbortController();
  const { signal } = _trajAbortCtrl;

  d3.json(`${API_BASE}/session/${hfIndex}`, { signal }).then(session => {
    _trajAbortCtrl = null;

    const ticks = session.ticks || [];
    const gameType = session.game_type;

    const trajDiv = document.getElementById(targetDivId);
    if (!trajDiv) return;
    while (trajDiv.firstChild) trajDiv.removeChild(trajDiv.firstChild);

    // Root uses flex for responsive left/right
    trajDiv.style.display = "flex";
    trajDiv.style.gap = "16px";

    const leftDiv = document.createElement("div");
    leftDiv.id = "traj-left";
    leftDiv.className = "traj-half";

    const rightDiv = document.createElement("div");
    rightDiv.id = "traj-right";
    rightDiv.className = "traj-half";

    trajDiv.appendChild(leftDiv);
    trajDiv.appendChild(rightDiv);

    const caption = d3.select(captionSelector);

    if (ticks.length === 0) {
      leftDiv.innerHTML = "<p>No tick data.</p>";
      caption.html(`<strong>Game:</strong> ${gameType} | <strong>Session:</strong> ${hfIndex} — no ticks`);
      return;
    }

    // Metadata (same as before)
    const pointData = scatterPoints.find(p => p.hf_index === hfIndex);
    const clusterId = pointData?.cluster ?? null;
    const clusterColor = clusterId != null ? (colorMap[clusterId] || "#888") : "#888";
    const clusterLabel = clusterId != null ? (CLUSTER_NAMES[clusterId] || `Cluster ${clusterId}`) : "Unknown";
    const gameId = GAME_TYPE_TO_ID[gameType] || null;
    const gameLabel = GAME_FILTERS.find(f => f.id === gameId)?.label || gameType;

    const cssVars = getComputedStyle(document.documentElement);
    const TOKENS = {
      bg: cssVars.getPropertyValue("--traj-bg").trim() || "#1a1a2a",
      border: cssVars.getPropertyValue("--traj-border").trim() || "#2e2e45",
      cursorUp: cssVars.getPropertyValue("--traj-cursor-up").trim() || "#c8c8c8",
      cursorDown: cssVars.getPropertyValue("--traj-cursor-down").trim() || "#00c8ff",
      trailUp: cssVars.getPropertyValue("--traj-trail-up").trim() || "#c8c8c8",
      trailDown: cssVars.getPropertyValue("--traj-trail-down").trim() || "#00c8ff",
    };

    const MAX_TRAIL = 500;
    const CHAR_DELAY = 84;
    const PHYSICS_HZ = 240;
    const msPerTick = 1000 / PHYSICS_HZ;

    // ─── LEFT PANEL (canvas fills available space) ─────────────────────────────
    const lW = leftDiv.clientWidth; //|| 520;
    const lH = leftDiv.clientHeight;// || 520;

    const canvas = d3.select(leftDiv)
      .append("canvas")
      .attr("width", lW)
      .attr("height", lH)
      .attr("class", "traj-overlay");

    const ctx = canvas.node().getContext("2d");

    const lSvg = d3.select(leftDiv)
      .append("svg")
      .attr("width", lW)
      .attr("height", lH)
      .attr("viewBox", `0 0 ${lW} ${lH}`)
      .attr("preserveAspectRatio", "xMinYMin meet")
      .attr("class", "traj-overlay");

    const pad = 12;
    const bottom = { legH: 20, ctrlH: 30, gap: 15 };
    const bottomH = bottom.legH + bottom.ctrlH + bottom.gap * 2;
    const availH = lH - pad - bottomH;

    let plotSz = Math.min(lW - pad * 2, availH);
    let plotX = pad + (lW - pad * 2 - plotSz) / 2;
    let plotY = pad + (availH - plotSz) / 2;

    // ─── State ────────────────────────────────────────────────
    const trajState = { frame: 0, paused: false, playing: true, ended: false };
    let revealDone = false;
    let twStarted = false;
    const trail = [];
    // Typewriter generation counter — incremented on every reset so that
    // any setTimeout callbacks still in flight from a previous run are
    // silently dropped when they fire (they check their captured gen).
    let _twGen = 0;
    // Scales
    const xSc = d3.scaleLinear()
      .domain(d3.extent(ticks, d => d.x))
      .range([plotX + 6, plotX + plotSz - 6]);
    const ySc = d3.scaleLinear()
      .domain(d3.extent(ticks, d => d.y))
      .range([plotY + plotSz - 6, plotY + 6]);

    // Cursor dot
    const cursor = lSvg.append("circle")
      .attr("r", 4)
      .attr("fill", TOKENS.cursorUp)
      .attr("opacity", 0);

    // ─── Controls (HTML, positioned in left div) ──────────────
    const legY = plotY + plotSz + bottom.gap;
    const ctrlY = legY + bottom.legH ;

    const ctrlDiv = document.createElement("div");
    ctrlDiv.className = "traj-ctrl";
    ctrlDiv.style.left = `${plotX}px`;
    ctrlDiv.style.top = `${ctrlY}px`;
    ctrlDiv.style.width = `${plotSz}px`;
    leftDiv.appendChild(ctrlDiv);

    const playBtn = document.createElement("button");
    playBtn.textContent = "⏸";
    playBtn.className = "traj-play-btn";

    const scrubber = document.createElement("input");
    scrubber.type = "range";
    scrubber.min = "0";
    scrubber.max = String(ticks.length - 1);
    scrubber.value = "0";
    scrubber.className = "traj-scrubber";

    const timeLabel = document.createElement("span");
    timeLabel.className = "traj-time-label";
    timeLabel.textContent = "0 ms";

    ctrlDiv.appendChild(playBtn);
    ctrlDiv.appendChild(scrubber);
    ctrlDiv.appendChild(timeLabel);

    // ─── Trail legend (in left SVG) ───────────────────────────
    // Store refs so recalcLayout can reposition them on resize.
    const legendItems = [
      { col: TOKENS.cursorUp, lbl: "Mouse up", isDown: false, colorClass: "traj-legend-up" },
      { col: TOKENS.cursorDown, lbl: "Mouse down", isDown: true, colorClass: "traj-legend-down" },
    ];
    const legendLineNodes = [];
    const legendTextNodes = [];

    legendItems.forEach(({ lbl, isDown, colorClass }, li) => {
      legendLineNodes.push(
        lSvg.append("line")
          .attr("class", `traj-legend-line ${colorClass}`)
          .attr("stroke-width", isDown ? 2.2 : 1.5)
          .attr("stroke-dasharray", isDown ? "0" : "4,3")
      );
      legendTextNodes.push(
        lSvg.append("text")
          .attr("class", `traj-legend-label ${colorClass}`)
          .attr("dominant-baseline", "middle")
          .text(lbl)
      );
    });

    function positionLegend(legYPos) {
      legendItems.forEach(({ }, li) => {
        const lx = plotX + li * 110;
        legendLineNodes[li]
          .attr("x1", lx).attr("y1", legYPos)
          .attr("x2", lx + 16).attr("y2", legYPos);
        legendTextNodes[li]
          .attr("x", lx + 20).attr("y", legYPos);
      });
    }

    positionLegend(legY);

    // ─── RIGHT PANEL — now more responsive ─────────────────────────────────────
    const rW = rightDiv.clientWidth || 320;
    const rH = rightDiv.clientHeight || 520;

    const rSvg = d3.select(rightDiv)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${rW} ${rH}`)
      .attr("preserveAspectRatio", "xMinYMin meet")
      .attr("class", "traj-overlay");

    const rPad = 12;

    // Game badge (top-leftish)
    const iconR = Math.min(rW * 0.11, 28);
    const iconCX = rPad + iconR;
    const iconCY = rPad + iconR;

    const badge = rSvg.append("circle")
      .attr("cx", iconCX).attr("cy", iconCY).attr("r", iconR)
      .attr("class", "traj-badge");

    // Icon (same)
    let iconG = null;
    if (gameId && svgIcons[gameId]) {
      iconG = rSvg.append("g").attr("class", "traj-icon");
      iconG.html(svgIcons[gameId]);
      const bb = iconG.node().getBBox();
      const sc = (iconR * 1.3) / Math.max(bb.width, bb.height);
      iconG.attr("transform", `translate(${iconCX - bb.x * sc - bb.width * sc / 2},${iconCY - bb.y * sc - bb.height * sc / 2}) scale(${sc})`);
    }

    // Game label + session id
    const labelX = iconCX + iconR + 12;
    rSvg.append("text")
      .attr("x", labelX).attr("y", iconCY - 6)
      .attr("dominant-baseline", "middle")
      .attr("class", "traj-label-bold")
      .text(gameLabel);

    rSvg.append("text")
      .attr("x", labelX).attr("y", iconCY + 10)
      .attr("dominant-baseline", "middle")
      .attr("class", "traj-label-sm")
      .text(`#${hfIndex}`);

    // ─── Replay button: right of badge, vertically centered with it ─────────────
    const replayW = 72, replayH = 20;
    const replayX = rW - replayW - rPad;
    const replayY = replayH / 2;

    const btnBg = rSvg.append("rect")
      .attr("x", replayX).attr("y", replayY)
      .attr("width", replayW).attr("height", replayH)
      .attr("rx", 4)
      .attr("class", "traj-replay-rect")
      .attr("opacity", 0);

    const btnTxt = rSvg.append("text")
      .attr("x", replayX + replayW / 2).attr("y", replayY + replayH / 2)
      .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
      .attr("class", "traj-label-sm")
      .style("pointer-events", "none")
      .attr("opacity", 0)
      .text("▶ Replay");

    [btnBg, btnTxt].forEach(el => el.on("click", startAnim));

    // ─── Typewriter stats (starts below badge area) ───────────────────────────
    const statsLines = [
      `Speed:       ${pointData?.speed_mean?.toFixed(2) ?? "—"}`,
      `Efficiency:  ${pointData?.path_efficiency?.toFixed(2) ?? "—"}`,
      `Pause rate:  ${pointData?.pause_rate?.toFixed(2) ?? "—"}`,
      `Duration:    ${pointData?.duration?.toFixed(2) ?? "—"}`,
      `Anomaly:     ${pointData?.anomaly_score?.toFixed(2) ?? "—"}`,
    ];
    const lineH = 15;
    const typeY = iconCY + iconR + 24;   // a bit more breathing room

    // ── Split right panel into left text column and right radar column ──
    // Text column: left rPad → ~55% of rW; radar column: remainder
    const textColW = Math.floor(rW * 0.52);
    const radarColX = textColW + rPad;
    const radarColW = rW - radarColX - rPad;

    const typeX = rPad;

    const typeNodes = statsLines.map((_, li) =>
      rSvg.append("text")
        .attr("x", typeX).attr("y", typeY + li * lineH)
        .attr("dominant-baseline", "hanging")
        .attr("class", "traj-label-mono")
        .text("")
    );

    // Cluster label (Behavior group:)
    const clusterLabelY = typeY + statsLines.length * lineH + 18;
    const clusterNameY = clusterLabelY + lineH + 4;

    const prefixNode = rSvg.append("text")
      .attr("x", typeX).attr("y", clusterLabelY)
      .attr("dominant-baseline", "hanging")
      .attr("class", "traj-label-mono")
      .attr("opacity", 0).text("");

    const nameNode = rSvg.append("text")
      .attr("x", typeX).attr("y", clusterNameY)
      .attr("dominant-baseline", "hanging")
      .attr("class", "traj-label-mono-bold")
      .style("fill", clusterColor)
      .attr("opacity", 0).text("");

    // ─── Radar snapshot — same top as typewriter, right column ──────────────
    // Height available: from typeY down to bottom of panel
    const radarBottomLimit = plotY + plotSz;  // mirrors left canvas plot bottom
    const radarAvailH = Math.min(rH - typeY - rPad, radarBottomLimit - typeY);
    const radarSnapR = Math.max(16, Math.min(radarColW / 2, radarAvailH / 2)) * 0.7;
    const radarSnapCX = (radarColX + radarColW / 2);
    const radarSnapCY = typeY + radarSnapR + 4;  // small top offset inside column

    const snapG = rSvg.append("g").attr("class", "traj-radar-snap");

    if (radarSnapR > 16 && pointData) {
      const nF = FEATURES.length;
      const aSlice = (2 * Math.PI) / nF;

      // Grid
      const gridG = snapG.append("g");
      [0.33, 0.66, 1].forEach(frac => {
        gridG.append("circle")
          .attr("cx", radarSnapCX).attr("cy", radarSnapCY)
          .attr("r", radarSnapR * frac)
          .attr("class", "traj-radar-grid");
      });
      FEATURES.forEach((_, i) => {
        const a = i * aSlice - Math.PI / 2;
        gridG.append("line")
          .attr("x1", radarSnapCX).attr("y1", radarSnapCY)
          .attr("x2", radarSnapCX + Math.cos(a) * radarSnapR)
          .attr("y2", radarSnapCY + Math.sin(a) * radarSnapR)
          .attr("class", "traj-radar-grid");
      });

      // Point profile (grey until reveal)
      const ptVals = FEATURES.map(f => featureScales[f](pointData[f]));
      const radialLine = d3.lineRadial()
        .radius(v => v * radarSnapR)
        .angle((_, i) => i * aSlice);

      const basePoly = snapG.append("path")
        .datum([...ptVals, ptVals[0]])
        .attr("transform", `translate(${radarSnapCX},${radarSnapCY})`)
        .attr("d", radialLine)
        .attr("fill", "var(--text-lo)")
        .attr("opacity", 0.5);

      // Cluster centroid dashed outline (hidden until reveal)
      const centroid = state.clusterCentroids?.find(c => c.cluster === clusterId);
      let clusterPoly = null;
      if (centroid) {
        const cVals = FEATURES.map(f => featureScales[f](centroid[f]));
        clusterPoly = snapG.append("path")
          .datum([...cVals, cVals[0]])
          .attr("transform", `translate(${radarSnapCX},${radarSnapCY})`)
          .attr("d", radialLine)
          .attr("fill", "none")
          .attr("stroke", clusterColor)
          .attr("stroke-width", 1)
          .attr("stroke-opacity", 0)
      }

      // Feature labels
      FEATURES.forEach((f, i) => {
        const a = i * aSlice - Math.PI / 2;
        const lx = radarSnapCX + Math.cos(a) * (radarSnapR + 10);
        const ly = radarSnapCY + Math.sin(a) * (radarSnapR + 10);
        snapG.append("text")
          .attr("x", lx).attr("y", ly)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("class", "radar-axis-label")
          .text(f);
      });

      // Expose reveal
      snapG._revealRadar = function () {
        if (clusterPoly) {
          clusterPoly
            .transition()
            .duration(600)
            .ease(d3.easeCubicOut)
            .attr("stroke-opacity", 0.85);
        }
        basePoly.transition().duration(600).ease(d3.easeCubicOut)
          //.attr("stroke", clusterColor)
          .attr("fill", d3.color(clusterColor).copy({ opacity: 0.5 }));
      };

      // Expose reset — interrupts any in-flight transition and restores
      // each element to its exact initial attribute values.
      snapG._resetRadar = function () {
        basePoly.interrupt()
          .attr("fill", "var(--text-lo)")
          .attr("opacity", 0.5);

        if (clusterPoly) {
          clusterPoly.interrupt()
            .attr("fill", "none")
            .attr("stroke-opacity", 0);
        }
      };
    }

    // =========================================================
    // Resize handler — debounced, full layout recalc + redraw
    // =========================================================
    let _resizeTimer = null;

    function recalcLayout() {
      // ── 1. Re-measure the left panel ─────────────────────────
      const newLW = leftDiv.clientWidth;
      const newLH = leftDiv.clientHeight;
      if (!newLW || !newLH) return;

      // ── 2. Resize canvas & SVG to match new dimensions ───────
      const canvasEl = canvas.node();
      canvasEl.width = newLW;
      canvasEl.height = newLH;
      lSvg.attr("width", newLW)
        .attr("height", newLH)
        .attr("viewBox", `0 0 ${newLW} ${newLH}`);

      // ── 3. Recompute layout geometry (mirrors initial setup) ──
      const newPlotSz = Math.min(newLW - pad * 2,
        newLH - pad - bottomH);
      const newPlotX = pad + (newLW - pad * 2 - newPlotSz) / 2;
      const newPlotY = pad + ((newLH - pad - bottomH) - newPlotSz) / 2;

      // Mutate the closed-over variables so every downstream
      // function (drawBackground, drawSegment, drawFrameAt …)
      // picks up the new geometry automatically.
      plotSz = newPlotSz;  // eslint-disable-line no-global-assign
      plotX = newPlotX;
      plotY = newPlotY;

      // ── 4. Update D3 scales to new pixel range ────────────────
      xSc.range([plotX + 6, plotX + plotSz - 6]);
      ySc.range([plotY + plotSz - 6, plotY + 6]);

      // ── 5. Reposition the controls overlay + legend ──────────
      const newLegY = plotY + plotSz + bottom.gap;
      const newCtrlY = newLegY + bottom.legH + bottom.gap;
      ctrlDiv.style.left = `${plotX}px`;
      ctrlDiv.style.top = `${newCtrlY}px`;
      ctrlDiv.style.width = `${plotSz}px`;
      positionLegend(newLegY);

      // ── 6. Redraw the current frame (no animation step) ───────
      const f = Math.min(trajState.frame, ticks.length - 1);
      drawFrameAt(f);
    }

    function handleResize() {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(recalcLayout, 150);
    }

    window.addEventListener("resize", handleResize);

    // Cleanup on abort / next render
    if (_trajAbortCtrl) {
      _trajAbortCtrl.signal.addEventListener("abort", () => {
        clearTimeout(_resizeTimer);
        window.removeEventListener("resize", handleResize);
      });
    }

    // =========================================================
    // SHARED HELPERS
    // =========================================================

    function msAt(f) {
      const idx = ticks[f]?.sampleIndex ?? f;
      return Math.round(idx * msPerTick);
    }
    function totalMs() { return msAt(ticks.length - 1); }

    function syncControls() {
      scrubber.value = String(trajState.frame);
      const cur = msAt(Math.min(trajState.frame, ticks.length - 1));
      timeLabel.textContent = `${cur} / ${totalMs()} ms`;
    }

    function typeLines(lines, nodes, delay, onDone, gen) {
      // Each call captures the generation at invocation time.
      // If _twGen has moved on by the time a timer fires, we drop it.
      function typeLine(li) {
        if (gen !== _twGen) return;
        if (li >= lines.length) { if (onDone) onDone(); return; }
        let ci = 0;
        (function typeChar() {
          if (gen !== _twGen) return;
          if (ci > lines[li].length) { typeLine(li + 1); return; }
          nodes[li].text(lines[li].slice(0, ci++));
          setTimeout(typeChar, delay);
        })();
      }
      typeLine(0);
    }

function revealCluster() {

  const prefixText = "Behavior group: ";
  const FADE_D = 2400;
  const PAUSE = 500;

  // Capture the generation active at the moment this reveal was scheduled.
  // If startAnim() is called before we finish, _twGen will have advanced
  // and every pending setTimeout below will bail out harmlessly.
  const gen = _twGen;

  // ── Reset state ───────────────────────────────
  prefixNode.text("").attr("opacity", 1);
  nameNode.text("").attr("opacity", 0);

  // ── 1. TYPE PREFIX ONLY ───────────────────────
  let i = 0;

  function typePrefix() {
    if (gen !== _twGen) return;
    if (i <= prefixText.length) {
      prefixNode.text(prefixText.slice(0, i++));
      setTimeout(typePrefix, CHAR_DELAY);
      return;
    }

    // ── 2. pause before reveal ───────────────────
    setTimeout(revealAll, PAUSE);
  }

  function revealAll() {
    if (gen !== _twGen) return;

    // trigger radar immediately at reveal moment
    if (snapG._revealRadar) snapG._revealRadar();

    // icon + badge fade together
    if (iconG) {
      iconG.selectAll("path, circle, rect, polygon, ellipse")
        .transition()
        .duration(FADE_D)
        .ease(d3.easeCubicOut)
        .style("fill", clusterColor)
        .style("stroke", clusterColor);
    }

    badge
      .transition()
      .duration(FADE_D)
      .ease(d3.easeCubicOut)
      .attr("stroke", clusterColor)
      .attr("fill", clusterColor + "22");

    // fade in BOTH text elements together
    prefixNode
      .transition()
      .duration(FADE_D)
      .ease(d3.easeCubicOut)
      .attr("opacity", 1);

    nameNode
      .text(clusterLabel)
      .transition()
      .duration(FADE_D)
      .ease(d3.easeCubicOut)
      .attr("opacity", 1);

    // show replay after everything settles
    setTimeout(() => { if (gen === _twGen) showReplayButton(); }, FADE_D + 500);
  }

  typePrefix();
}

    function showReplayButton() {
      btnBg.transition().duration(400).attr("opacity", 1);
      btnTxt.transition().duration(400).attr("opacity", 1);
    }

    // =========================================================
    // CANVAS DRAWING
    // =========================================================

    function drawBackground() {
      ctx.fillStyle = TOKENS.bg;
      ctx.strokeStyle = TOKENS.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(plotX, plotY, plotSz, plotSz, 4);
      } else {
        ctx.rect(plotX, plotY, plotSz, plotSz);
      }
      ctx.fill();
      ctx.stroke();
    }

    function drawSegment(prev, seg, i, len) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(plotX, plotY, plotSz, plotSz);
      ctx.clip();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(seg.x, seg.y);
      const alpha = 0.01 + (i / len) * 0.8;
      ctx.strokeStyle = seg.isDown ? TOKENS.trailDown : TOKENS.trailUp;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = seg.isDown ? 2.2 : 1.5;
      ctx.setLineDash(seg.isDown ? [] : [4, 3]);
      ctx.stroke();
      ctx.restore();
    }

    // Full redraw for scrubbing
    function drawFrameAt(f) {
      ctx.clearRect(0, 0, lW, lH);
      drawBackground();
      trail.length = 0;
      const start = Math.max(0, f - MAX_TRAIL + 1);
      for (let i = start; i <= f; i++) {
        const pt = ticks[i];
        const seg = { x: xSc(pt.x), y: ySc(pt.y), isDown: pt.isDown };
        trail.push(seg);
        if (trail.length > 1) drawSegment(trail[trail.length - 2], seg, trail.length - 1, trail.length);
      }
      if (f < ticks.length) {
        const pt = ticks[f];
        cursor.attr("cx", xSc(pt.x)).attr("cy", ySc(pt.y))
          .attr("fill", pt.isDown ? TOKENS.cursorDown : TOKENS.cursorUp)
          .attr("opacity", 0.9);
      }
    }

    drawBackground();

    // =========================================================
    // ANIMATION LOOP
    // =========================================================

    function animateMouse() {
      if (!trajState.playing || trajState.paused) return;

      const f = trajState.frame;

      if (f >= ticks.length) {
        trajState.playing = false;
        trajState.ended = true;
        _trajRafId = null;
        if (!revealDone) { revealDone = true; revealCluster(); }
        playBtn.textContent = "↺";
        return;
      }

      if (!twStarted && f > 20) {
        twStarted = true;
        typeLines(statsLines, typeNodes, CHAR_DELAY, null, _twGen);
      }

      const pt = ticks[f];
      const px = xSc(pt.x);
      const py = ySc(pt.y);

      if (f === 0) cursor.attr("opacity", 0.9);
      cursor.attr("cx", px).attr("cy", py)
        .attr("fill", pt.isDown ? TOKENS.cursorDown : TOKENS.cursorUp);

      const seg = { x: px, y: py, isDown: pt.isDown };
      trail.push(seg);
      if (trail.length > MAX_TRAIL) trail.shift();

      // Clear only the plot box — right panel is in a separate div/SVG
      ctx.clearRect(plotX, plotY, plotSz, plotSz);
      drawBackground();
      for (let j = 1; j < trail.length; j++) {
        drawSegment(trail[j - 1], trail[j], j, trail.length);
      }

      syncControls();
      trajState.frame = f + 1;
      _trajRafId = requestAnimationFrame(animateMouse);
    }

    // =========================================================
    // RESET + REPLAY
    // =========================================================

function startAnim() {
  if (_trajRafId) { cancelAnimationFrame(_trajRafId); _trajRafId = null; }

  // Invalidate all in-flight typewriter and reveal setTimeout callbacks.
  _twGen++;

  trajState.frame = 0;
  trajState.paused = false;
  trajState.playing = true;
  trajState.ended = false;
  revealDone = false;
  twStarted = false;

  trail.length = 0;
  cursor.attr("opacity", 0);

  typeNodes.forEach(n => n.text(""));

  // ── RESET CLUSTER TEXT ─────────────────────────────
  prefixNode
    .interrupt()
    .text("")
    .attr("opacity", 0);

  nameNode
    .interrupt()
    .text("")
    .attr("opacity", 0);

  // ── RESET RADAR VISUAL STATE ───────────────────────
  if (snapG._resetRadar) snapG._resetRadar();

  // ── RESET ICON + BADGE ─────────────────────────────
  // interrupt() cancels any in-flight fade transition before we clear attrs,
  // so the transition end-value can't land after our reset.
  badge
    .interrupt()
    .attr("stroke", null)
    .attr("fill", null);

  if (iconG) {
    iconG.selectAll("path, circle, rect, polygon, ellipse")
      .interrupt()
      .style("fill", null)
      .style("stroke", null);
  }

  // ── HIDE REPLAY BUTTON ─────────────────────────────
  btnBg.interrupt().attr("opacity", 0);
  btnTxt.interrupt().attr("opacity", 0);

  ctx.clearRect(0, 0, lW, lH);
  drawBackground();

  scrubber.value = "0";
  playBtn.textContent = "⏸";
  syncControls();
  animateMouse();
}

    // =========================================================
    // CONTROL EVENTS
    // =========================================================

    playBtn.addEventListener("click", () => {
      if (trajState.ended || trajState.frame >= ticks.length) {
        startAnim();
        return;
      }
      trajState.paused = !trajState.paused;
      playBtn.textContent = trajState.paused ? "▶" : "⏸";
      if (!trajState.paused) {
        if (_trajRafId) { cancelAnimationFrame(_trajRafId); _trajRafId = null; }
        animateMouse();
      }
    });

    // Track whether user is actively dragging (not just clicking)
    let scrubWasPlaying = false;
    let scrubDragging = false;

    scrubber.addEventListener("pointerdown", () => {
      scrubDragging = false; // reset; input event will set true if it fires during drag
      scrubWasPlaying = trajState.playing && !trajState.paused && !trajState.ended;
    });

    scrubber.addEventListener("input", () => {
      scrubDragging = true;
      const f = parseInt(scrubber.value, 10);
      trajState.frame = f;
      trajState.ended = false;
      if (_trajRafId) { cancelAnimationFrame(_trajRafId); _trajRafId = null; }
      drawFrameAt(f);
      syncControls();
      // Show paused indicator only while dragging
      if (scrubWasPlaying) playBtn.textContent = "▶";
    });

    scrubber.addEventListener("pointerup", () => {
      if (!scrubDragging) return; // was a click, no drag — do nothing to play state
      scrubDragging = false;
      if (scrubWasPlaying && !trajState.ended) {
        trajState.paused = false;
        trajState.playing = true;
        playBtn.textContent = "⏸";
        animateMouse();
      }
    });


    // Initial draw + start
    drawBackground();
    animateMouse();

  }).catch(err => {
    if (err?.name === "AbortError") return;
    const trajDiv = document.getElementById(targetDivId);
    if (trajDiv) trajDiv.innerHTML = `<p class="traj-error">Failed to load session (${err.message || err})</p>`;
  });
}