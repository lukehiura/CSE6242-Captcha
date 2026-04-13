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
    const bottom = { legH: 20, ctrlH: 30, gap: 6 };
    const bottomH = bottom.legH + bottom.ctrlH + bottom.gap * 2;
    const availH = lH - pad - bottomH;

    const plotSz = Math.min(lW - pad * 2, availH);
    const plotX = pad + (lW - pad * 2 - plotSz) / 2;
    const plotY = pad + (availH - plotSz) / 2;

    // ─── State ────────────────────────────────────────────────
    const trajState = { frame: 0, paused: false, playing: true, ended: false };
    let revealDone = false;
    let twStarted = false;
    const trail = [];
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
    const ctrlY = legY + bottom.legH + bottom.gap;

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
    [[TOKENS.cursorUp, "Mouse up", false], [TOKENS.cursorDown, "Mouse down", true]].forEach(([col, lbl, isDown], li) => {
      lSvg.append("line")
        .attr("x1", plotX + li * 100).attr("y1", legY + 1)
        .attr("x2", plotX + li * 100 + 14).attr("y2", legY + 1)
        .attr("stroke", col)
        .attr("stroke-width", isDown ? 2.2 : 1.5)
        .attr("stroke-dasharray", isDown ? "0" : "4,3");
      lSvg.append("text")
        .attr("x", plotX + li * 100 + 18).attr("y", legY + 1)
        .attr("dominant-baseline", "middle")
        .text(lbl);
    });

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
    const replayY = iconCY - replayH / 2;

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
    const typeX = rPad;
    const typeY = iconCY + iconR + 24;   // a bit more breathing room

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

    // ─── Radar snapshot (fills remaining vertical space) ─────────────────────
    const radarTopY = clusterNameY + lineH + 16;
    const radarAvailH = rH - radarTopY - rPad * 1.5;
    const radarAvailW = rW - rPad * 2;
    const radarSnapR = Math.max(16, Math.min(radarAvailW / 2, radarAvailH / 2));
    const radarSnapCX = rPad + radarAvailW / 2;
    const radarSnapCY = radarTopY + radarSnapR;

    const snapG = rSvg.append("g").attr("class", "traj-radar-snap");

    if (radarSnapR > 16 && pointData) {
      const nF = FEATURES.length;
      const aSlice = (2 * Math.PI) / nF;

      // Grid
      const gridG = snapG.append("g").attr("class", "traj-radar-grid-layer");
      [0.33, 0.66, 1].forEach(frac => {
        gridG.append("circle")
          .attr("cx", radarSnapCX).attr("cy", radarSnapCY)
          .attr("r", radarSnapR * frac)
          .attr("class", "traj-radar-grid").attr("opacity", 0.35);
      });
      FEATURES.forEach((_, i) => {
        const a = i * aSlice - Math.PI / 2;
        gridG.append("line")
          .attr("x1", radarSnapCX).attr("y1", radarSnapCY)
          .attr("x2", radarSnapCX + Math.cos(a) * radarSnapR)
          .attr("y2", radarSnapCY + Math.sin(a) * radarSnapR)
          .attr("class", "traj-radar-grid").attr("opacity", 0.35);
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
        .attr("fill", "#888899")
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
          .attr("class", "traj-label-sm")
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
    }

    // =========================================================
    // Resize handler (makes everything more responsive)
    // =========================================================
    let resizeTimeout = null;
    function handleResize() {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // Re-measure and redraw key elements if needed
        // For a full re-render you could call renderMouseTrajectory again,
        // but for smoother experience we can update SVGs/canvas sizes here.
        const newLW = leftDiv.clientWidth;
        const newLH = leftDiv.clientHeight;
        if (newLW && newLH) {
          canvas.attr("width", newLW).attr("height", newLH);
          lSvg.attr("width", newLW).attr("height", newLH);
          // You may want to re-compute plotSz / scales and redraw background here
        }
      }, 120);
    }

    window.addEventListener("resize", handleResize);

    // Cleanup on abort / next render
    if (_trajAbortCtrl) {
      _trajAbortCtrl.signal.addEventListener("abort", () => {
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

    function typeLines(lines, nodes, delay, onDone) {
      function typeLine(li) {
        if (li >= lines.length) { if (onDone) onDone(); return; }
        let ci = 0;
        (function typeChar() {
          if (ci > lines[li].length) { typeLine(li + 1); return; }
          nodes[li].text(lines[li].slice(0, ci++));
          setTimeout(typeChar, delay);
        })();
      }
      typeLine(0);
    }

    function revealCluster() {

      // 1. start prefix typing
      prefixNode.attr("opacity", 1);
      const prefixText = "Behavior group: ";
      let ci = 0;
      let revealStarted = false;
      (function typePrefix() {
        // when prefix completes → trigger reveal ONCE
        if (ci === prefixText.length && !revealStarted) {
          revealStarted = true;
          // 2. start radar + badge/icon color transition immediately
          if (snapG._revealRadar) snapG._revealRadar();
          if (iconG) {
            iconG.selectAll("path, circle, rect, polygon, ellipse")
              .transition()
              .duration(1800)
              .ease(d3.easeCubicOut)
              .style("fill", clusterColor)
              .style("stroke", clusterColor);
          }
          badge.transition()
            .duration(1800)
            .ease(d3.easeCubicOut)
            .attr("stroke", clusterColor)
            .attr("fill", clusterColor + "22");
        }
        // continue prefix typing
        if (ci <= prefixText.length) {
          prefixNode.text(prefixText.slice(0, ci++));
          setTimeout(typePrefix, CHAR_DELAY);
          return;
        }

        // 3. start typing cluster name AFTER prefix fully done
        nameNode.attr("opacity", 1);

        let ni = 0;

        (function typeName() {

          if (ni > clusterLabel.length) {

            // 4. final polish (optional re-assert color consistency)
            if (iconG) {
              iconG.selectAll("path, circle, rect, polygon, ellipse")
                .style("fill", clusterColor)
                .style("stroke", clusterColor);
            }

            badge
              .attr("stroke", clusterColor)
              .attr("fill", clusterColor + "22");

            // 5. show replay
            showReplayButton();

            return;
          }

          nameNode.text(clusterLabel.slice(0, ni++));
          setTimeout(typeName, CHAR_DELAY);

        })();

      })();
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
        typeLines(statsLines, typeNodes, CHAR_DELAY, null);
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

      trajState.frame = 0;
      trajState.paused = false;
      trajState.playing = true;
      trajState.ended = false;
      revealDone = false;
      twStarted = false;

      trail.length = 0;
      cursor.attr("opacity", 0);
      typeNodes.forEach(n => n.text(""));
      prefixNode.attr("opacity", 0).text("");
      nameNode.attr("opacity", 0).text("");

      // Hide replay button again
      btnBg.attr("opacity", 0);
      btnTxt.attr("opacity", 0);

      // Reset badge
      badge.attr("stroke", null).attr("fill", null);
      if (iconG) iconG.selectAll("path, circle, rect, polygon, ellipse")
        .style("fill", null).style("stroke", null);

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

    scrubber.addEventListener("input", () => {
      const f = parseInt(scrubber.value, 10);
      trajState.frame = f;
      trajState.paused = true;
      trajState.playing = true;
      trajState.ended = false;
      playBtn.textContent = "▶";
      drawFrameAt(f);
      syncControls();
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