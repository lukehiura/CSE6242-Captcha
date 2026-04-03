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

    const totalW = trajDiv.clientWidth  || 600;
    const totalH = trajDiv.clientHeight || 300;
    const pad    = 20;
    const plotSz = Math.min(totalW / 2 - pad * 2, totalH - pad * 2);
    const plotX  = pad + (totalW / 2 - pad * 2 - plotSz) / 2;
    const plotY  = pad + (totalH - pad * 2 - plotSz) / 2;
    const rightX = totalW / 2 + pad;
    const rightW = totalW / 2 - pad * 2;

    const canvas = d3.select(`#${targetDivId}`)
      .append("canvas")
      .attr("width",  totalW)
      .attr("height", totalH)
      .style("position", "absolute")
      .style("top",  "0").style("left", "0")
      .style("pointer-events", "none");
    const ctx = canvas.node().getContext("2d");

    const tSvg = d3.select(`#${targetDivId}`)
      .append("svg")
      .attr("width",  totalW)
      .attr("height", totalH)
      .attr("viewBox", `0 0 ${totalW} ${totalH}`)
      .attr("preserveAspectRatio", "xMinYMin meet")
      .style("position", "absolute")
      .style("top", "0").style("left", "0")
      .style("pointer-events", "none");

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
      .attr("opacity", 0);

    const legY = plotY + plotSz + pad / 2;
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
      .attr("fill", "#1a1a1a").attr("stroke", "#555").attr("stroke-width", 1.5);

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
      .attr("dominant-baseline", "middle").attr("class", "filters-text")
      .style("font-weight", "bold").style("font-size", "11px")
      .text(gameLabel);

    tSvg.append("text")
      .attr("x", iconCX + iconR + 8).attr("y", iconCY + 14)
      .attr("dominant-baseline", "middle").attr("class", "filters-text")
      .style("font-size", "10px")
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
        .attr("dominant-baseline", "hanging").attr("class", "filters-text")
        .style("font-family", "monospace").style("font-size", "10px")
        .text("")
    );

    const clusterY   = typeY + statsLines.length * lineH + 8;
    const prefix     = "Behavior group: ";
    const prefixNode = tSvg.append("text")
      .attr("x", typeX).attr("y", clusterY)
      .attr("dominant-baseline", "hanging").attr("class", "filters-text")
      .style("font-family", "monospace").style("font-size", "10px")
      .attr("opacity", 0).text("");
    const nameNode = tSvg.append("text")
      .attr("x", typeX).attr("y", clusterY)
      .attr("dominant-baseline", "hanging").attr("class", "filters-text")
      .style("font-family", "monospace").style("font-size", "10px")
      .style("font-weight", "bold").style("fill", clusterColor)
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
        .attr("fill", "#222").attr("stroke", "#666").attr("stroke-width", 1)
        .attr("opacity", 0)
        .style("cursor", "pointer").style("pointer-events", "all");

      const btnTxt = tSvg.append("text")
        .attr("x", typeX + btnW / 2).attr("y", btnY + btnH / 2)
        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
        .attr("class", "filters-text")
        .style("font-size", "10px").style("pointer-events", "none")
        .attr("opacity", 0)
        .text("▶ Replay");

      btnBg.transition().duration(400).attr("opacity", 1);
      btnTxt.transition().duration(400).attr("opacity", 1);

      function startAnim() {
        if (_trajRafId) { cancelAnimationFrame(_trajRafId); _trajRafId = null; }
        frame = 0;
        trail.length = 0;
        twStarted = false;
        sampleText.attr("opacity", 0);
        cursor.attr("opacity", 0);
        typeNodes.forEach(n => n.text(""));
        prefixNode.attr("opacity", 0).text("");
        nameNode.attr("opacity", 0).text("");
        badge.attr("stroke", "#555").attr("fill", "#1a1a1a");
        if (iconG) iconG.selectAll("path, circle, rect, polygon, ellipse")
          .style("fill", null).style("stroke", null);
        ctx.clearRect(0, 0, totalW, totalH);
        animateMouse();
      }

      [btnBg, btnTxt].forEach(el => el.on("click", startAnim));
    }

    function drawBackground() {
      ctx.fillStyle = "#1a1a2a";
      ctx.strokeStyle = "#2e2e45";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(plotX, plotY, plotSz, plotSz, 4);
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

    let frame = 0, twStarted = false;
    const trail = [];

    drawBackground();

    function animateMouse() {
      if (frame >= ticks.length) {
        revealCluster();
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

      sampleText.text(`${frame + 1} / ${ticks.length}`).attr("opacity", 0.55);
      frame++;
      _trajRafId = requestAnimationFrame(animateMouse);
    }

    animateMouse();

  }).catch(err => {
    if (err?.name === "AbortError") return;
    const trajDiv = document.getElementById(targetDivId);
    if (trajDiv) trajDiv.innerHTML =
      `<p style="padding:8px;color:#c66">Failed to load session (${err.message || err})</p>`;
  });
}
