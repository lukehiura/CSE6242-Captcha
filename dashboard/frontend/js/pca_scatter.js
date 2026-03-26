// ===================== PCA Scatter - Interactive Cluster Highlight ===================== //
Promise.all([
  d3.json("data/scatter_points.json"),
  d3.json("data/cluster_meta.json")
]).then(([points, clusters]) => {

  const width = 600, height = 600, margin = {top:90, right:90, bottom:90, left:90};

  // Filter out outliers
  points = points.filter(d => d.is_outlier !== 4);

  // Map cluster numbers to names
  const clusterNames = {
    0: "Fast-Balanced-Fluid",
    1: "Slow-Balanced-Fluid",
    2: "Moderate-Circuitous-Hesitant",
    3: "Moderate-Direct-Fluid"
  };

  // Cluster color map (categorical, soft palette)
  const colorPalette = ["#4daf4a","#377eb8","#ff7f00","#e41a1c"];
  const colorMap = {};
  clusters.forEach((c,i) => colorMap[c.id] = colorPalette[i % colorPalette.length]);

  // Compute square scales
  const xExtent = d3.extent(points, d => d.pca_x);
  const yExtent = d3.extent(points, d => d.pca_y);
  const minVal = Math.min(xExtent[0], yExtent[0]);
  const maxVal = Math.max(xExtent[1], yExtent[1]);

  const x = d3.scaleLinear()
              .domain([minVal, maxVal])
              .range([margin.left, width - margin.right]);

  const y = d3.scaleLinear()
              .domain([minVal, maxVal])
              .range([height - margin.bottom, margin.top]);

  // SVG container
  const svg = d3.select("#scatter")
                .append("svg")
                .attr("width", width)
                .attr("height", height)
                .style("background","#f9f9f9");

  // Axes
  const xAxis = svg.append("g")
     .attr("transform", `translate(0,${height - margin.bottom})`)
     .call(d3.axisBottom(x));

  const yAxis = svg.append("g")
     .attr("transform", `translate(${margin.left},0)`)
     .call(d3.axisLeft(y));

  // Axis labels
  // X-axis: Slow ← PC1 → Fast
  svg.append("text")
     .attr("x", width/2)
     .attr("y", height - margin.bottom/2)
     .attr("text-anchor","middle")
	 .attr("dominant-baseline","middle")
     .style("font-size","1rem")
     .text("PC1");
	 
  svg.append("text")
     .attr("x", margin.left)
     .attr("y", height - margin.bottom/2)
     .attr("text-anchor","start")
	 .attr("dominant-baseline","middle")
     .style("font-size","0.75rem")
     .text("Slow Speed");
	 
  svg.append("text")
     .attr("x", width - margin.right)
     .attr("y", height - margin.bottom/2)
     .attr("text-anchor","end")
	 .attr("dominant-baseline","middle")
     .style("font-size","0.75rem")
     .text("Fast Speed");

  // Y-axis: Length ↑ PC2 ↓ Efficient
  svg.append("text")
     .attr("x", -height/2)
     .attr("y", margin.left/2)
     .attr("text-anchor","middle")
	 .attr("dominant-baseline","middle")
     .style("font-size","1rem")
     .attr("transform","rotate(-90)")
     .text("PC2");

  svg.append("text")
     .attr("x", -height+margin.bottom)
     .attr("y", margin.left/2)
     .attr("text-anchor","start")
	 .attr("dominant-baseline","middle")
     .style("font-size","0.75rem")
     .attr("transform","rotate(-90)")
     .text("Efficient Path");
	 
  svg.append("text")
     .attr("x", -margin.top)
     .attr("y", margin.left/2)
     .attr("text-anchor","end")
	 .attr("dominant-baseline","middle")
     .style("font-size","0.75rem")
     .attr("transform","rotate(-90)")
     .text("Long Path");
	 

  // Tooltip div
  const tooltip = d3.select("body")
                    .append("div")
                    .style("position", "absolute")
                    .style("padding", "6px")
                    .style("background", "rgba(0,0,0,0.7)")
                    .style("color", "white")
                    .style("border-radius", "4px")
                    .style("pointer-events", "none")
                    .style("opacity", 0)
                    .style("font-size", "0.85rem");

  // Draw dots
  const circles = svg.selectAll("circle")
    .data(points)
    .enter()
    .append("circle")
    .attr("cx", d => x(d.pca_x))
    .attr("cy", d => y(d.pca_y))
    .attr("r", 1)
    .attr("fill", d => colorMap[d.cluster])
    .attr("opacity", 0.4);

  // Hover effect: highlight cluster
  circles.on("mouseover", (event,d) => {
      circles.attr("opacity", o => o.cluster === d.cluster ? 1 : 0.15);

      tooltip.transition().duration(200).style("opacity", 0.9);
      tooltip.html(`
        <strong>Cluster:</strong> ${clusterNames[d.cluster]}<br/>
        <strong>Game type:</strong> ${d.game_type}<br/>
        <strong>PC1:</strong> ${d.pca_x.toFixed(2)}<br/>
        <strong>PC2:</strong> ${d.pca_y.toFixed(2)}
      `)
      .style("left", (event.pageX + 10) + "px")
      .style("top", (event.pageY - 28) + "px");
  })
  .on("mouseout", () => {
      circles.attr("opacity", 0.4);
      tooltip.transition().duration(200).style("opacity", 0);
  });

});