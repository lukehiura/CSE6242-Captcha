// ---------------- SINGLE TRAJECTORY TEST ----------------
d3.json("data/sheep_herd_test_session.json").then(data => {

  const tickInputs = data.tickInputs; // array of {x, y, isDown, sampleIndex}

  const trajDiv = document.getElementById("trajectory-plot");
  const width = trajDiv.clientWidth;
  const height = trajDiv.clientHeight;
  const margin = {top: 20, right: 20, bottom: 20, left: 20};

  const svg = d3.select("#trajectory-plot")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Scales for mouse trajectory
  const xScale = d3.scaleLinear()
    .domain(d3.extent(tickInputs, d => d.x))
    .range([margin.left, width - margin.right]);

  const yScale = d3.scaleLinear()
    .domain(d3.extent(tickInputs, d => d.y))
    .range([height - margin.bottom, margin.top]); // flip Y

  // Circle cursor
  const cursor = svg.append("circle")
    .attr("r", 5)
    .attr("fill", "steelblue")
    .attr("opacity", 0.8);

  // Trail line
  let trailData = [];
  const trailLine = svg.append("path")
    .attr("fill", "none")
    .attr("stroke", "red")
    .attr("stroke-width", 2)
    .attr("opacity", 0.8);

  // Optional: label current sampleIndex
  const label = svg.append("text")
    .attr("x", 10)
    .attr("y", 20)
    .style("font-size", "12px")
    .style("fill", "#111");

  // Animate
  let i = 0;
  function animateMouse() {
    if (i >= tickInputs.length) return;

    const point = tickInputs[i];
    const px = xScale(point.x);
    const py = yScale(point.y);

    // Move cursor
    cursor
      .attr("cx", px)
      .attr("cy", py)
      .attr("fill", point.isDown ? "red" : "steelblue");

    // Update trail
    trailData.push([px, py]);
    trailLine.attr("d", d3.line()(trailData));

    // Update label
    label.text(`sampleIndex: ${point.sampleIndex}`);

    i++;
    requestAnimationFrame(animateMouse);
  }

  animateMouse();

});