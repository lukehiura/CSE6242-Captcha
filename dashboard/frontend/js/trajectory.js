let _trajAbortCtrl = null;
let _trajRafId = null;

function renderMouseTrajectory(hfIndex, targetDivId, captionSelector, scatterPoints) {
  // ─── Cancel any in-flight work ─────────────────────────────
  if (_trajAbortCtrl) {
    _trajAbortCtrl.abort();
    _trajAbortCtrl = null;
  }

  if (_trajRafId) {
    cancelAnimationFrame(_trajRafId);
    _trajRafId = null;
  }

  _trajAbortCtrl = new AbortController();
  const { signal } = _trajAbortCtrl;

  // ─── Fetch session ─────────────────────────────────────────
  d3.json(`${API_BASE}/session/${hfIndex}`, { signal }).then(session => {
    _trajAbortCtrl = null;

    const ticks = session.ticks || [];
    const gameType = session.game_type;

    const trajDiv = document.getElementById(targetDivId);
    if (!trajDiv) return;

    // Fast clear (better than innerHTML = "" in heavy DOM cases)
    while (trajDiv.firstChild) trajDiv.removeChild(trajDiv.firstChild);

    const caption = d3.select(captionSelector);

    if (ticks.length === 0) {
      trajDiv.innerHTML = "<p>No tick data.</p>";
      caption.html(
        `<strong>Game:</strong> ${gameType} | <strong>Session:</strong> ${hfIndex} — no ticks`
      );
      return;
    }

    // ─── Lookup metadata ──────────────────────────────────────
    const pointData = scatterPoints.find(p => p.hf_index === hfIndex);

    const clusterId = pointData?.cluster ?? null;
    const clusterColor = clusterId != null ? (colorMap[clusterId] || "#888") : "#888";
    const clusterLabel = clusterId != null
      ? (CLUSTER_NAMES[clusterId] || `Cluster ${clusterId}`)
      : "Unknown";

    const gameId = GAME_TYPE_TO_ID[gameType] || null;
    const gameLabel = GAME_FILTERS.find(f => f.id === gameId)?.label || gameType;

    // ─── CSS TOKENS (single read = important) ─────────────────
    const css = getComputedStyle(document.documentElement);

    const TOKENS = {
      bg: css.getPropertyValue("--traj-bg").trim(),
      border: css.getPropertyValue("--traj-border").trim(),
      cursorUp: css.getPropertyValue("--traj-cursor-up").trim(),
      cursorDown: css.getPropertyValue("--traj-cursor-down").trim(),
      trailUp: css.getPropertyValue("--traj-trail-up").trim(),
      trailDown: css.getPropertyValue("--traj-trail-down").trim(),
    };

    // ─── Constants ────────────────────────────────────────────
    const MAX_TRAIL = 500;
    const CHAR_DELAY = 84;

    const PHYSICS_HZ = 240;
    const msPerTick = 1000 / PHYSICS_HZ;

    // ─── Layout ───────────────────────────────────────────────
    const w = trajDiv.clientWidth || 600;
    const h = trajDiv.clientHeight || 300;

    const layout = {
      w,
      h,
      pad: 16,

      leftW: w * 0.5,
      rightW: w * 0.5,

      bottom: {
        legH: 20,
        ctrlH: 34,
        gap: 6
      },

      plot: {
        x: 0,
        y: 0,
        s: 0
      },

      right: {
        x: 0,
        w: 0
      },
    };

    const pad = layout.pad;

    const bottomH =
      layout.bottom.legH +
      layout.bottom.ctrlH +
      layout.bottom.gap * 2;
    const availH = h - pad - bottomH;

    // plot sizing (square)
    layout.plot.s = Math.min(
      layout.leftW - pad * 2,
      availH
    );

    layout.plot.x = pad + (layout.leftW - pad * 2 - layout.plot.s) / 2;
    layout.plot.y = pad + (availH - layout.plot.s) / 2;

    // right panel
    layout.right.x = layout.leftW + pad;
    layout.right.w = layout.rightW - pad * 2;

    // ─── Canvas (render layer) ────────────────────────────────
    const canvas = d3.select(`#${targetDivId}`)
      .append("canvas")
      .attr("width", w)
      .attr("height", h)
      .attr("class", "traj-overlay");

    const ctx = canvas.node().getContext("2d");

    // ─── SVG (UI layer) ───────────────────────────────────────
    const tSvg = d3.select(`#${targetDivId}`)
      .append("svg")
      .attr("width", w)
      .attr("height", h)
      .attr("viewBox", `0 0 ${w} ${h}`)
      .attr("preserveAspectRatio", "xMinYMin meet")
      .attr("class", "traj-overlay");

    // ─── Scales ───────────────────────────────────────────────
    const xExtent = d3.extent(ticks, d => d.x);
    const yExtent = d3.extent(ticks, d => d.y);

    const xSc = d3.scaleLinear()
      .domain(xExtent)
      .range([layout.plot.x + 6, layout.plot.x + layout.plot.s - 6]);

    const ySc = d3.scaleLinear()
      .domain(yExtent)
      .range([layout.plot.y + layout.plot.s - 6, layout.plot.y + 6]);

    // ─── Cursor ───────────────────────────────────────────────
    const cursor = tSvg.append("circle")
      .attr("r", 4)
      .attr("fill", TOKENS.cursorUp)
      .attr("opacity", 0);

    const sampleText = tSvg.append("text")
      .attr("x", layout.plot.x + layout.plot.s / 2)
      .attr("y", layout.plot.y + layout.plot.s + 14)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "hanging")
      .attr("class", "filters-text")
      .style("display", "none");

    const legY = layout.plot.y + layout.plot.s + layout.bottom.gap;
    const ctrlY =
      layout.plot.y +
      layout.plot.s +
      layout.bottom.gap +
      layout.bottom.legH +
      layout.bottom.gap;

    const ctrlDiv = document.createElement("div");
    ctrlDiv.className = "traj-ctrl";
    ctrlDiv.style.left = `${layout.plot.x}px`;
    ctrlDiv.style.top = `${ctrlY}px`;
    ctrlDiv.style.width = `${layout.plot.s}px`;

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
    trajDiv.appendChild(ctrlDiv);

    [[TOKENS.cursorUp, "Mouse up", false], [TOKENS.cursorDown, "Mouse down", true]].forEach(([col, lbl, isDown], li) => {
      tSvg.append("line")
        .attr("x1", layout.plot.x + li * 110).attr("y1", legY + 1)
        .attr("x2", layout.plot.x + li * 110 + 14).attr("y2", legY + 1)
        .attr("stroke", col).attr("stroke-width", isDown ? 2.2 : 1.5)
        .attr("stroke-dasharray", isDown ? "0" : "4,3");
      tSvg.append("text")
        .attr("x", layout.plot.x + li * 110 + 18).attr("y", legY + 1)
        .attr("dominant-baseline", "middle").attr("class", "filters-text")
        .text(lbl);
    });

    const iconR = Math.min(layout.right.w * 0.18, 28);
    const iconCX = layout.right.x + iconR + 2;
    const iconCY = layout.plot.y + iconR + 4;

    const badge = tSvg.append("circle")
      .attr("cx", iconCX).attr("cy", iconCY).attr("r", iconR)
      .attr("class", "traj-badge");

    let iconG = null;
    if (gameId && svgIcons[gameId]) {
      iconG = tSvg.append("g").attr("class", "traj-icon");
      iconG.html(svgIcons[gameId]);
      const bb = iconG.node().getBBox();
      const sc = (iconR * 1.3) / Math.max(bb.width, bb.height);
      iconG.attr("transform",
        `translate(${iconCX - bb.x * sc - bb.width * sc / 2},${iconCY - bb.y * sc - bb.height * sc / 2}) scale(${sc})`
      );
    }

    tSvg.append("text")
      .attr("x", iconCX + iconR + 8).attr("y", iconCY)
      .attr("dominant-baseline", "middle").attr("class", "filters-text traj-label-bold")
      .text(gameLabel);

    tSvg.append("text")
      .attr("x", iconCX + iconR + 8).attr("y", iconCY + 14)
      .attr("dominant-baseline", "middle").attr("class", "filters-text traj-label-sm")
      .text(`#${hfIndex}`);

    const statsLines = [
      `Speed:       ${pointData?.speed_mean?.toFixed(2) ?? "—"}`,
      `Efficiency:  ${pointData?.path_efficiency?.toFixed(2) ?? "—"}`,
      `Pause rate:  ${pointData?.pause_rate?.toFixed(2) ?? "—"}`,
      `Duration:    ${pointData?.duration?.toFixed(2) ?? "—"}`,
      `Anomaly:     ${pointData?.anomaly_score?.toFixed(2) ?? "—"}`,
    ];
    const lineH = 15;
    const typeY = iconCY + iconR + 18;
    const typeX = layout.right.x + 4;
    const typeNodes = statsLines.map((_, li) =>
      tSvg.append("text")
        .attr("x", typeX).attr("y", typeY + li * lineH)
        .attr("dominant-baseline", "hanging").attr("class", "filters-text traj-label-mono")
        .text("")
    );

    const clusterY = typeY + statsLines.length * lineH + 8;
    const prefix = "Behavior group: ";
    const prefixNode = tSvg.append("text")
      .attr("x", typeX).attr("y", clusterY)
      .attr("dominant-baseline", "hanging").attr("class", "filters-text traj-label-mono")
      .attr("opacity", 0).text("");
    const nameNode = tSvg.append("text")
      .attr("x", typeX).attr("y", clusterY)
      .attr("dominant-baseline", "hanging").attr("class", "filters-text traj-label-mono-bold")
      .style("fill", clusterColor)
      .attr("opacity", 0).text("");

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
      prefixNode.attr("opacity", 1);
      let ci = 0;
      (function typeChar() {
        if (ci > prefix.length) {
          nameNode.attr("opacity", 1);
          try { nameNode.attr("x", typeX + prefixNode.node().getBBox().width); } catch (e) { }
          let ni = 0;
          (function typeName() {
            if (ni > clusterLabel.length) {
              if (iconG) iconG.selectAll("path, circle, rect, polygon, ellipse")
                .transition().duration(600).ease(d3.easeCubicOut)
                .style("fill", clusterColor).style("stroke", clusterColor);
              badge.transition().duration(600).ease(d3.easeCubicOut)
                .attr("stroke", clusterColor).attr("fill", clusterColor + "22");
              showReplayButton();
              return;
            }
            nameNode.text(clusterLabel.slice(0, ni++));
            setTimeout(typeName, CHAR_DELAY);
          })();
          return;
        }
        prefixNode.text(prefix.slice(0, ci++));
        setTimeout(typeChar, CHAR_DELAY);
      })();
    }

    function showReplayButton() {
      const btnY = clusterY + 22;
      const btnW = 64, btnH = 20;

      const btnBg = tSvg.append("rect")
        .attr("x", typeX).attr("y", btnY)
        .attr("width", btnW).attr("height", btnH)
        .attr("rx", 4)
        .attr("class", "traj-replay-rect")
        .attr("opacity", 0);

      const btnTxt = tSvg.append("text")
        .attr("x", typeX + btnW / 2).attr("y", btnY + btnH / 2)
        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
        .attr("class", "filters-text traj-label-sm")
        .style("pointer-events", "none")
        .attr("opacity", 0)
        .text("▶ Replay");

      btnBg.transition().duration(400).attr("opacity", 1);
      btnTxt.transition().duration(400).attr("opacity", 1);

      function startAnim() {
        if (_trajRafId) { cancelAnimationFrame(_trajRafId); _trajRafId = null; }
        frame = 0; trail.length = 0; twStarted = false; revealDone = false;
        paused = false;
        playBtn.textContent = "⏸";
        cursor.attr("opacity", 0);
        typeNodes.forEach(n => n.text(""));
        prefixNode.attr("opacity", 0).text("");
        nameNode.attr("opacity", 0).text("");
        badge
          .attr("stroke", null)
          .attr("fill", null);
        if (iconG) iconG.selectAll("path, circle, rect, polygon, ellipse")
          .style("fill", null).style("stroke", null);
        ctx.clearRect(0, 0, w, h);
        drawBackground();
        syncControls();
        animateMouse();
      }

      [btnBg, btnTxt].forEach(el => el.on("click", startAnim));
    }

    function drawBackground() {
      ctx.fillStyle = TOKENS.trajBg;
      ctx.strokeStyle = TOKENS.trajBorder;
      ctx.lineWidth = 1;

      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(layout.plot.x, layout.plot.y, layout.plot.s, layout.plot.s, 4);
      } else {
        ctx.rect(layout.plot.x, layout.plot.y, layout.plot.s, layout.plot.s);
      }

      ctx.fill();
      ctx.stroke();
    }

    function drawTrail() {
      ctx.clearRect(0, 0, w, h);
      drawBackground();

      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.plot.x, layout.plot.y, layout.plot.s, layout.plot.s);
      ctx.clip();

      for (let j = 1; j < trail.length; j++) {
        const seg = trail[j];
        const prev = trail[j - 1];
        const alpha = 0.3 + (j / trail.length) * 0.7;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(seg.x, seg.y);
        ctx.strokeStyle = seg.isDown ? TOKENS.trailDown : TOKENS.trailUp;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = seg.isDown ? 2.2 : 1.5;
        ctx.setLineDash(seg.isDown ? [] : [4, 3]);
        ctx.stroke();
      }

      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }

    let frame = 0, twStarted = false, paused = false, revealDone = false;
    const trail = [];

    function msAt(f) {
      const idx = ticks[f]?.sampleIndex ?? f;
      return Math.round(idx * msPerTick);
    }

    function totalMs() {
      return msAt(ticks.length - 1);
    }

    function syncControls() {
      scrubber.value = String(frame);
      const cur = msAt(Math.min(frame, ticks.length - 1));
      const tot = totalMs();
      timeLabel.textContent = `${cur} / ${tot} ms`;
    }

    function drawFrameAt(f) {
      trail.length = 0;
      const start = Math.max(0, f - MAX_TRAIL + 1);
      for (let i = start; i <= f; i++) {
        const pt = ticks[i];
        trail.push({ x: xSc(pt.x), y: ySc(pt.y), isDown: pt.isDown });
      }
      drawTrail();
      if (f < ticks.length) {
        const pt = ticks[f];
        const px = xSc(pt.x), py = ySc(pt.y);
        cursor.attr("cx", px)
          .attr("cy", py)
          .attr("fill", pt.isDown ? TOKENS.cursorDown : TOKENS.cursorUp)
          .attr("opacity", 0.9);
      }
    }

    drawBackground();

    function animateMouse() {
      if (paused) return;

      if (frame >= ticks.length) {
        if (!revealDone) { revealDone = true; revealCluster(); }
        playBtn.textContent = "↺";
        return;
      }

      if (!twStarted && frame > 20) {
        twStarted = true;
        typeLines(statsLines, typeNodes, CHAR_DELAY, null);
      }

      const pt = ticks[frame];
      const px = xSc(pt.x), py = ySc(pt.y);

      if (frame === 0) cursor.attr("opacity", 0.9);
      cursor.attr("cx", px).attr("cy", py)
        .attr("fill", pt.isDown ? TOKENS.cursorDown : TOKENS.cursorUp);

      trail.push({ x: px, y: py, isDown: pt.isDown });
      if (trail.length > MAX_TRAIL) trail.shift();

      drawTrail();
      syncControls();
      frame++;
      _trajRafId = requestAnimationFrame(animateMouse);
    }

    playBtn.addEventListener("click", () => {
      if (frame >= ticks.length) {
        frame = 0; trail.length = 0; twStarted = false; revealDone = false;
        typeNodes.forEach(n => n.text(""));
        prefixNode.attr("opacity", 0).text("");
        nameNode.attr("opacity", 0).text("");
        badge
          .attr("stroke", null)
          .attr("fill", null);
        if (iconG) iconG.selectAll("path, circle, rect, polygon, ellipse")
          .style("fill", null).style("stroke", null);
        cursor.attr("opacity", 0);
        ctx.clearRect(0, 0, w, h);
        drawBackground();
        paused = false;
        playBtn.textContent = "⏸";
        animateMouse();
        return;
      }
      paused = !paused;
      playBtn.textContent = paused ? "▶" : "⏸";
      if (!paused) animateMouse();
    });

    scrubber.addEventListener("input", () => {
      const f = parseInt(scrubber.value, 10);
      frame = f;
      paused = true;
      playBtn.textContent = "▶";
      ctx.clearRect(0, 0, w, h);
      drawFrameAt(f);
      syncControls();
    });

    animateMouse();

  }).catch(err => {
    if (err?.name === "AbortError") return;
    const trajDiv = document.getElementById(targetDivId);
    if (trajDiv) trajDiv.innerHTML =
      `<p class="traj-error">Failed to load session (${err.message || err})</p>`;
  });
}