let _trajAbortCtrl = null;
let _trajRafId     = null;

function renderMouseTrajectory(hfIndex, targetDivId, captionSelector, scatterPoints) {
  if (_trajAbortCtrl) { _trajAbortCtrl.abort(); _trajAbortCtrl = null; }
  if (_trajRafId)     { cancelAnimationFrame(_trajRafId); _trajRafId = null; }

  _trajAbortCtrl = new AbortController();
  const signal   = _trajAbortCtrl.signal;

  d3.json(`${API_BASE}/session/${hfIndex}`, { signal }).then(session => {
    _trajAbortCtrl = null;

    const ticks    = session.ticks || [];
    const gameType = session.game_type;

    const trajDiv = document.getElementById(targetDivId);
    if (!trajDiv) return;
    trajDiv.innerHTML = "";

    const caption = d3.select(captionSelector);

    if (ticks.length === 0) {
      trajDiv.innerHTML = "<p>No tick data.</p>";
      caption.html(`<strong>Game:</strong> ${gameType} | <strong>Session:</strong> ${hfIndex} — no ticks`);
      return;
    }

    const pointData    = scatterPoints.find(p => p.hf_index === hfIndex);
    const clusterId    = pointData?.cluster ?? null;
    const clusterColor = clusterId != null ? (colorMap[clusterId] || "#888") : "#888";
    const clusterLabel = clusterId != null ? (CLUSTER_NAMES[clusterId] || `Cluster ${clusterId}`) : "Unknown";
    const gameId       = GAME_TYPE_TO_ID[gameType] || null;
    const gameLabel    = GAME_FILTERS.find(f => f.id === gameId)?.label || gameType;

    const CURSOR_UP   = "#c8c8c8";
    const CURSOR_DOWN = "#00c8ff";
    const MAX_TRAIL   = 500;
    const CHAR_DELAY  = 84;

    const totalW   = trajDiv.clientWidth  || 600;
    const totalH   = trajDiv.clientHeight || 300;
    const pad      = 16;
    const legH     = 20;
    const ctrlH    = 34;
    const bottomH  = legH + 6 + ctrlH + 6;
    const availH   = totalH - pad - bottomH;
    const halfW    = totalW / 2;
    const plotSz   = Math.min(halfW - pad * 2, availH);
    const plotX    = pad + (halfW - pad * 2 - plotSz) / 2;
    const plotY    = pad + (availH - plotSz) / 2;
    const rightX   = halfW + pad;
    const rightW   = halfW - pad * 2;

    const canvas = d3.select(`#${targetDivId}`)
      .append("canvas")
      .attr("width",  totalW)
      .attr("height", totalH)
      .attr("class", "traj-overlay");
    const ctx = canvas.node().getContext("2d");

    const tSvg = d3.select(`#${targetDivId}`)
      .append("svg")
      .attr("width",  totalW)
      .attr("height", totalH)
      .attr("viewBox", `0 0 ${totalW} ${totalH}`)
      .attr("preserveAspectRatio", "xMinYMin meet")
      .attr("class", "traj-overlay");

    const xSc = d3.scaleLinear().domain(d3.extent(ticks, d => d.x)).range([plotX + 6, plotX + plotSz - 6]);
    const ySc = d3.scaleLinear().domain(d3.extent(ticks, d => d.y)).range([plotY + plotSz - 6, plotY + 6]);

    const cursor = tSvg.append("circle").attr("r", 4)
      .attr("fill", CURSOR_UP).attr("opacity", 0);

    const sampleText = tSvg.append("text")
      .attr("x", plotX + plotSz / 2)
      .attr("y", plotY + plotSz + 14)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "hanging")
      .attr("class", "filters-text")
      .style("display", "none");

    const PHYSICS_HZ = 240;
    const msPerTick  = 1000 / PHYSICS_HZ;

    const legY    = plotY + plotSz + 6;
    const ctrlY   = legY + legH + 6;

    const ctrlDiv = document.createElement("div");
    ctrlDiv.className = "traj-ctrl";
    ctrlDiv.style.left   = `${plotX}px`;
    ctrlDiv.style.top    = `${ctrlY}px`;
    ctrlDiv.style.width  = `${plotSz}px`;
    ctrlDiv.style.height = `${ctrlH}px`;

    const playBtn = document.createElement("button");
    playBtn.textContent = "⏸";
    playBtn.className = "traj-play-btn";

    const scrubber = document.createElement("input");
    scrubber.type  = "range";
    scrubber.min   = "0";
    scrubber.max   = String(ticks.length - 1);
    scrubber.value = "0";
    scrubber.className = "traj-scrubber";

    const timeLabel = document.createElement("span");
    timeLabel.className = "traj-time-label";
    timeLabel.textContent = "0 ms";

    ctrlDiv.appendChild(playBtn);
    ctrlDiv.appendChild(scrubber);
    ctrlDiv.appendChild(timeLabel);
    trajDiv.appendChild(ctrlDiv);

    [[CURSOR_UP, "Mouse up", false], [CURSOR_DOWN, "Mouse down", true]].forEach(([col, lbl, isDown], li) => {
      tSvg.append("line")
        .attr("x1", plotX + li * 110).attr("y1", legY + 1)
        .attr("x2", plotX + li * 110 + 14).attr("y2", legY + 1)
        .attr("stroke", col).attr("stroke-width", isDown ? 2.2 : 1.5)
        .attr("stroke-dasharray", isDown ? "0" : "4,3");
      tSvg.append("text")
        .attr("x", plotX + li * 110 + 18).attr("y", legY + 1)
        .attr("dominant-baseline", "middle").attr("class", "filters-text")
        .text(lbl);
    });

    const iconR  = Math.min(rightW * 0.18, 28);
    const iconCX = rightX + iconR + 2;
    const iconCY = plotY + iconR + 4;

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
    const lineH     = 15;
    const typeY     = iconCY + iconR + 18;
    const typeX     = rightX + 4;
    const typeNodes = statsLines.map((_, li) =>
      tSvg.append("text")
        .attr("x", typeX).attr("y", typeY + li * lineH)
        .attr("dominant-baseline", "hanging").attr("class", "filters-text traj-label-mono")
        .text("")
    );

    const clusterY   = typeY + statsLines.length * lineH + 8;
    const prefix     = "Behavior group: ";
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
          try { nameNode.attr("x", typeX + prefixNode.node().getBBox().width); } catch (e) {}
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
      const btnY  = clusterY + 22;
      const btnW  = 64, btnH = 20;

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
        badge.attr("stroke", "#555").attr("fill", "#1a1a1a");
        if (iconG) iconG.selectAll("path, circle, rect, polygon, ellipse")
          .style("fill", null).style("stroke", null);
        ctx.clearRect(0, 0, totalW, totalH);
        drawBackground();
        syncControls();
        animateMouse();
      }

      [btnBg, btnTxt].forEach(el => el.on("click", startAnim));
    }

    function drawBackground() {
      ctx.fillStyle = "#1a1a2a";
      ctx.strokeStyle = "#2e2e45";
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

    function drawTrail() {
      ctx.clearRect(0, 0, totalW, totalH);
      drawBackground();

      ctx.save();
      ctx.beginPath();
      ctx.rect(plotX, plotY, plotSz, plotSz);
      ctx.clip();

      for (let j = 1; j < trail.length; j++) {
        const seg  = trail[j];
        const prev = trail[j - 1];
        const alpha = 0.3 + (j / trail.length) * 0.7;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(seg.x, seg.y);
        ctx.strokeStyle = seg.isDown ? CURSOR_DOWN : CURSOR_UP;
        ctx.globalAlpha = alpha;
        ctx.lineWidth   = seg.isDown ? 2.2 : 1.5;
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
      scrubber.value  = String(frame);
      const cur       = msAt(Math.min(frame, ticks.length - 1));
      const tot       = totalMs();
      timeLabel.textContent = `${cur} / ${tot} ms`;
    }

    function drawFrameAt(f) {
      trail.length = 0;
      const start  = Math.max(0, f - MAX_TRAIL + 1);
      for (let i = start; i <= f; i++) {
        const pt = ticks[i];
        trail.push({ x: xSc(pt.x), y: ySc(pt.y), isDown: pt.isDown });
      }
      drawTrail();
      if (f < ticks.length) {
        const pt = ticks[f];
        const px = xSc(pt.x), py = ySc(pt.y);
        cursor.attr("cx", px).attr("cy", py)
          .attr("fill", pt.isDown ? CURSOR_DOWN : CURSOR_UP)
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
        .attr("fill", pt.isDown ? CURSOR_DOWN : CURSOR_UP);

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
        badge.attr("stroke", "#555").attr("fill", "#1a1a1a");
        if (iconG) iconG.selectAll("path, circle, rect, polygon, ellipse")
          .style("fill", null).style("stroke", null);
        cursor.attr("opacity", 0);
        ctx.clearRect(0, 0, totalW, totalH);
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
      frame  = f;
      paused = true;
      playBtn.textContent = "▶";
      ctx.clearRect(0, 0, totalW, totalH);
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