(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const state = {
    data: null,
    selectedId: null,
    viewId: "full",
    search: "",
    categories: new Set(),
    importance: new Set(["Core", "Important"]),
    positions: new Map(),
    visibleIds: new Set(),
    transform: { x: 20, y: 20, scale: 1 },
    world: { width: 1200, height: 700 },
    interaction: null,
  };

  const el = {};
  const byId = (id) => document.getElementById(id);
  const nodeById = (id) => state.data.nodes.find((node) => node.id === id);
  const svgEl = (name, attributes = {}) => {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  };
  const htmlEl = (name, className, text) => {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const clear = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  function cacheElements() {
    [
      "dataset-summary", "theme-toggle", "search-input", "view-select", "fit-button", "reset-button",
      "category-filters", "direct-toggle", "incoming-toggle", "graph-heading", "graph-count", "graph-wrap",
      "architecture-graph", "viewport", "clusters", "edges", "nodes", "edge-tooltip", "graph-empty",
      "legend", "details-placeholder", "details-content", "flow-title", "flow-select", "flow-diagram",
      "flow-note", "generation-note",
    ].forEach((id) => { el[id] = byId(id); });
  }

  async function loadData() {
    const response = await fetch("architecture-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error("Invalid architecture dataset");
    return data;
  }

  function initialize(data) {
    state.data = data;
    state.categories = new Set(data.categories);
    el["dataset-summary"].textContent = `${data.project.analysed_files} files analysed · ${data.nodes.length} documented nodes · ${data.edges.length} relationships`;
    el["generation-note"].textContent = `Generated deterministically by ${data.project.generated_by}; runtime data and secrets are excluded.`;
    populateViews();
    populateCategories();
    populateFlows();
    renderLegend();
    bindEvents();
    applyViewDefaults();
    rebuildGraph(true);
    renderFlow(data.flows[0].id);
  }

  function populateViews() {
    state.data.views.forEach((view) => {
      const option = htmlEl("option", "", view.name);
      option.value = view.id;
      el["view-select"].appendChild(option);
    });
  }

  function populateCategories() {
    state.data.categories.forEach((category, index) => {
      const label = htmlEl("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = category;
      input.checked = true;
      input.id = `category-${index}`;
      input.addEventListener("change", () => {
        if (input.checked) state.categories.add(category);
        else state.categories.delete(category);
        rebuildGraph(true);
      });
      label.append(input, document.createTextNode(category));
      el["category-filters"].appendChild(label);
    });
  }

  function populateFlows() {
    state.data.flows.forEach((flow) => {
      const option = htmlEl("option", "", flow.name);
      option.value = flow.id;
      el["flow-select"].appendChild(option);
    });
  }

  function renderLegend() {
    clear(el.legend);
    [
      ["core", "Core file"], ["important", "Important file"], ["supporting", "Supporting file"],
      ["test", "Test"], ["external", "Runtime / external / database"],
    ].forEach(([className, label]) => {
      const item = htmlEl("span", "legend-item");
      item.append(htmlEl("span", `legend-swatch ${className}`), document.createTextNode(label));
      el.legend.appendChild(item);
    });
    const direction = htmlEl("span", "legend-item", "Arrow: source uses, calls, renders, or sends data to target");
    el.legend.appendChild(direction);
  }

  function bindEvents() {
    el["view-select"].addEventListener("change", () => {
      state.viewId = el["view-select"].value;
      applyViewDefaults();
      rebuildGraph(true);
    });
    el["search-input"].addEventListener("input", () => {
      state.search = el["search-input"].value.trim().toLowerCase();
      rebuildGraph(true);
    });
    el["search-input"].addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const first = visibleNodes()[0];
        if (first) selectNode(first.id, true);
      }
    });
    document.querySelectorAll(".importance-filter").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) state.importance.add(input.value);
        else state.importance.delete(input.value);
        rebuildGraph(true);
      });
    });
    el["direct-toggle"].addEventListener("change", updateEmphasis);
    el["incoming-toggle"].addEventListener("change", updateEmphasis);
    el["fit-button"].addEventListener("click", fitGraph);
    el["reset-button"].addEventListener("click", () => rebuildGraph(true));
    el["theme-toggle"].addEventListener("click", toggleTheme);
    el["flow-select"].addEventListener("change", () => renderFlow(el["flow-select"].value));
    bindGraphInteractions();
    window.addEventListener("resize", debounce(fitGraph, 120));
  }

  function applyViewDefaults() {
    const testInput = document.querySelector('.importance-filter[value="Test"]');
    const supportInput = document.querySelector('.importance-filter[value="Supporting"]');
    if (state.viewId === "testing") {
      state.importance.add("Test");
      testInput.checked = true;
    } else {
      state.importance.delete("Test");
      testInput.checked = false;
    }
    if (state.viewId === "deployment") {
      state.importance.add("Supporting");
      supportInput.checked = true;
    }
  }

  function visibleNodes() {
    if (!state.data) return [];
    const view = state.data.views.find((item) => item.id === state.viewId);
    const allowedIds = view.node_ids ? new Set(view.node_ids) : null;
    const allowedCategories = view.categories && view.categories.length ? new Set(view.categories) : null;
    return state.data.nodes.filter((node) => {
      if (!state.importance.has(node.importance)) return false;
      if (!state.categories.has(node.category)) return false;
      if (allowedIds && !allowedIds.has(node.id)) return false;
      if (allowedCategories && !allowedCategories.has(node.category)) return false;
      if (!state.search) return true;
      const haystack = [node.id, node.label, node.category, node.purpose, ...(node.symbols || []), ...(node.routes || [])].join(" ").toLowerCase();
      return haystack.includes(state.search);
    });
  }

  function visibleEdges(ids) {
    return state.data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  }

  function rebuildGraph(resetPositions) {
    const nodes = visibleNodes();
    state.visibleIds = new Set(nodes.map((node) => node.id));
    if (state.selectedId && !state.visibleIds.has(state.selectedId)) {
      state.selectedId = null;
      renderDetails(null);
    }
    if (resetPositions) layoutNodes(nodes);
    renderGraph(nodes, visibleEdges(state.visibleIds));
    const view = state.data.views.find((item) => item.id === state.viewId);
    el["graph-heading"].textContent = view.name;
    el["graph-count"].textContent = `${nodes.length} nodes · ${visibleEdges(state.visibleIds).length} relationships`;
    el["graph-empty"].hidden = nodes.length !== 0;
    if (nodes.length) requestAnimationFrame(fitGraph);
  }

  function layoutNodes(nodes) {
    state.positions.clear();
    const grouped = new Map();
    nodes.forEach((node) => {
      if (!grouped.has(node.category)) grouped.set(node.category, []);
      grouped.get(node.category).push(node);
    });
    const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
    const columns = groups.length <= 3 ? Math.max(1, groups.length) : 3;
    const columnWidth = 440;
    const gapX = 34;
    const gapY = 34;
    const heights = Array(columns).fill(0);
    const clusterData = [];

    groups.forEach(([category, items], groupIndex) => {
      items.sort((a, b) => importanceRank(a.importance) - importanceRank(b.importance) || a.label.localeCompare(b.label));
      const col = groupIndex % columns;
      const x = col * (columnWidth + gapX);
      const y = heights[col];
      const rows = Math.ceil(items.length / 2);
      const height = 48 + rows * 76;
      clusterData.push({ category, x, y, width: columnWidth, height });
      items.forEach((node, index) => {
        const nodeX = x + 18 + (index % 2) * 207;
        const nodeY = y + 36 + Math.floor(index / 2) * 76;
        state.positions.set(node.id, { x: nodeX, y: nodeY });
      });
      heights[col] += height + gapY;
    });
    state.clusters = clusterData;
    state.world = {
      width: Math.max(600, columns * columnWidth + (columns - 1) * gapX),
      height: Math.max(420, ...heights),
    };
  }

  function importanceRank(value) {
    return ({ Core: 0, Important: 1, Supporting: 2, Test: 3 })[value] ?? 4;
  }

  function renderGraph(nodes, edges) {
    clear(el.clusters);
    clear(el.edges);
    clear(el.nodes);
    (state.clusters || []).forEach((cluster) => {
      const rect = svgEl("rect", { class: "cluster-box", x: cluster.x, y: cluster.y, width: cluster.width, height: cluster.height });
      const label = svgEl("text", { class: "cluster-label", x: cluster.x + 14, y: cluster.y + 21 });
      label.textContent = cluster.category;
      el.clusters.append(rect, label);
    });
    edges.forEach(renderEdge);
    nodes.forEach(renderNode);
    updateTransform();
    updateEmphasis();
  }

  function renderEdge(edge) {
    const source = state.positions.get(edge.source);
    const target = state.positions.get(edge.target);
    if (!source || !target) return;
    const path = svgEl("path", { class: "edge", "data-edge-id": edge.id });
    path.setAttribute("d", edgePath(source, target));
    path.addEventListener("pointerenter", (event) => showEdgeTooltip(edge, event));
    path.addEventListener("pointermove", (event) => positionTooltip(event));
    path.addEventListener("pointerleave", hideEdgeTooltip);
    el.edges.appendChild(path);
  }

  function edgePath(source, target) {
    const sx = source.x + 190;
    const sy = source.y + 28;
    const tx = target.x;
    const ty = target.y + 28;
    if (Math.abs(tx - sx) < 90) {
      const startX = source.x + 95;
      const startY = source.y + 56;
      const endX = target.x + 95;
      const endY = target.y;
      const midY = (startY + endY) / 2;
      return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
    }
    const bend = Math.max(40, Math.abs(tx - sx) * 0.42);
    const direction = tx >= sx ? 1 : -1;
    return `M ${sx} ${sy} C ${sx + bend * direction} ${sy}, ${tx - bend * direction} ${ty}, ${tx} ${ty}`;
  }

  function renderNode(node) {
    const position = state.positions.get(node.id);
    const group = svgEl("g", {
      class: "node",
      transform: `translate(${position.x} ${position.y})`,
      role: "button",
      tabindex: "0",
      "aria-label": `${node.label}, ${node.category}, ${node.importance}`,
      "data-node-id": node.id,
      "data-importance": node.importance,
      "data-node-type": node.node_type,
    });
    group.appendChild(svgEl("rect", { width: 190, height: 56 }));
    group.appendChild(svgEl("rect", { class: "node-accent", width: 6, height: 56, rx: 3 }));
    const title = svgEl("text", { x: 14, y: 23 });
    title.textContent = truncate(node.label, 25);
    const path = svgEl("text", { class: "node-path", x: 14, y: 41 });
    path.textContent = truncate(node.id, 32);
    group.append(title, path);
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNode(node.id, false);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(node.id, false);
      }
    });
    group.addEventListener("pointerdown", startNodeDrag);
    group.addEventListener("pointerup", (event) => {
      const interaction = state.interaction;
      if (
        interaction?.type === "node" &&
        interaction.id === node.id &&
        Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) < 5
      ) {
        selectNode(node.id, false);
      }
    });
    el.nodes.appendChild(group);
  }

  function truncate(value, max) {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
  }

  function showEdgeTooltip(edge, event) {
    clear(el["edge-tooltip"]);
    el["edge-tooltip"].append(htmlEl("strong", "", edge.type), document.createTextNode(edge.reason));
    el["edge-tooltip"].hidden = false;
    positionTooltip(event);
  }

  function positionTooltip(event) {
    const bounds = el["graph-wrap"].getBoundingClientRect();
    const tooltip = el["edge-tooltip"];
    const width = tooltip.offsetWidth || 300;
    const height = tooltip.offsetHeight || 70;
    tooltip.style.left = `${Math.max(8, Math.min(bounds.width - width - 8, event.clientX - bounds.left + 12))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(bounds.height - height - 8, event.clientY - bounds.top + 12))}px`;
  }

  function hideEdgeTooltip() {
    el["edge-tooltip"].hidden = true;
  }

  function selectNode(id, center) {
    state.selectedId = id;
    renderDetails(nodeById(id));
    updateEmphasis();
    if (center) centerNode(id);
  }

  function updateEmphasis() {
    const selected = state.selectedId;
    const related = new Set();
    const activeEdges = new Set();
    if (selected) {
      related.add(selected);
      state.data.edges.forEach((edge) => {
        if (el["direct-toggle"].checked && edge.source === selected && state.visibleIds.has(edge.target)) {
          related.add(edge.target);
          activeEdges.add(edge.id);
        }
        if (el["incoming-toggle"].checked && edge.target === selected && state.visibleIds.has(edge.source)) {
          related.add(edge.source);
          activeEdges.add(edge.id);
        }
      });
    }
    el.nodes.querySelectorAll(".node").forEach((node) => {
      const id = node.dataset.nodeId;
      node.classList.toggle("is-selected", id === selected);
      node.classList.toggle("is-related", selected && related.has(id) && id !== selected);
      node.classList.toggle("is-muted", selected && !related.has(id));
    });
    el.edges.querySelectorAll(".edge").forEach((edge) => {
      const isActive = activeEdges.has(edge.dataset.edgeId);
      edge.classList.toggle("is-active", isActive);
      edge.classList.toggle("is-muted", selected && !isActive);
    });
  }

  function renderDetails(node) {
    if (!node) {
      el["details-placeholder"].hidden = false;
      el["details-content"].hidden = true;
      clear(el["details-content"]);
      return;
    }
    el["details-placeholder"].hidden = true;
    el["details-content"].hidden = false;
    clear(el["details-content"]);

    el["details-content"].append(htmlEl("p", "eyebrow", "File details"), htmlEl("h2", "", node.label));
    const path = htmlEl("code", "details-path", node.path);
    el["details-content"].appendChild(path);
    const badges = htmlEl("div", "detail-badges");
    [node.category, node.importance, node.lines ? `${node.lines} lines` : node.node_type].forEach((value) => badges.appendChild(htmlEl("span", "badge", value)));
    el["details-content"].appendChild(badges);
    addTextSection("Primary purpose", node.purpose);
    addListSection("Main responsibilities", node.responsibilities);
    if (node.symbols?.length) addListSection("Important functions, classes, components, or tables", node.symbols);
    addRelationshipSection("Imports or depends on", node.dependencies, "outgoing");
    addRelationshipSection("Used by / incoming dependents", node.dependents, "incoming");
    if (node.communications?.length) addListSection("APIs or database tables", node.communications);
    if (node.routes?.length) addListSection("Flask routes", node.routes);
    if (node.config?.length) addListSection("Configuration / environment names", node.config);
    if (node.tests?.length) addRelationshipSection("Relevant tests", node.tests, "tests");
    addTextSection("Why this exists", node.why);
    addTextSection("What may break if this changes", node.breakage, "risk");
  }

  function addTextSection(title, text, className = "") {
    const section = htmlEl("section", `detail-section ${className}`.trim());
    section.append(htmlEl("h3", "", title), htmlEl("p", "", text));
    el["details-content"].appendChild(section);
  }

  function addListSection(title, values) {
    const section = htmlEl("section", "detail-section");
    section.appendChild(htmlEl("h3", "", title));
    const list = document.createElement("ul");
    values.forEach((value) => list.appendChild(htmlEl("li", "", value)));
    section.appendChild(list);
    el["details-content"].appendChild(section);
  }

  function addRelationshipSection(title, ids, mode) {
    if (!ids?.length) return;
    const section = htmlEl("section", "detail-section");
    section.appendChild(htmlEl("h3", "", title));
    const list = htmlEl("ul", "relationship-list");
    ids.forEach((id) => {
      const item = document.createElement("li");
      const button = htmlEl("button", "relationship-button", id);
      button.type = "button";
      button.addEventListener("click", () => revealNode(id, mode));
      item.appendChild(button);
      list.appendChild(item);
    });
    section.appendChild(list);
    el["details-content"].appendChild(section);
  }

  function revealNode(id) {
    const node = nodeById(id);
    if (!node) return;
    if (!state.importance.has(node.importance)) {
      state.importance.add(node.importance);
      const input = document.querySelector(`.importance-filter[value="${cssEscape(node.importance)}"]`);
      if (input) input.checked = true;
    }
    if (!state.categories.has(node.category)) {
      state.categories.add(node.category);
      const categoryInput = [...el["category-filters"].querySelectorAll("input")].find((input) => input.value === node.category);
      if (categoryInput) categoryInput.checked = true;
    }
    state.search = "";
    el["search-input"].value = "";
    const currentView = state.data.views.find((view) => view.id === state.viewId);
    const viewExcludes = currentView.node_ids ? !currentView.node_ids.includes(id) : currentView.categories?.length && !currentView.categories.includes(node.category);
    if (viewExcludes) {
      state.viewId = "full";
      el["view-select"].value = "full";
    }
    rebuildGraph(true);
    selectNode(id, true);
  }

  function cssEscape(value) {
    return value.replace(/["\\]/g, "\\$&");
  }

  function renderFlow(flowId) {
    const flow = state.data.flows.find((item) => item.id === flowId);
    if (!flow) return;
    el["flow-title"].textContent = flow.name;
    el["flow-note"].textContent = flow.note;
    clear(el["flow-diagram"]);
    flow.steps.forEach((id, index) => {
      const step = htmlEl("div", "flow-step");
      const node = nodeById(id);
      const button = htmlEl("button", "flow-node", node ? node.label : id);
      button.type = "button";
      button.addEventListener("click", () => revealNode(id));
      step.appendChild(button);
      if (index < flow.steps.length - 1) step.appendChild(htmlEl("span", "flow-arrow", "→"));
      el["flow-diagram"].appendChild(step);
    });
  }

  function bindGraphInteractions() {
    const svg = el["architecture-graph"];
    svg.addEventListener("pointerdown", (event) => {
      if (event.target.closest?.(".node")) return;
      svg.setPointerCapture(event.pointerId);
      state.interaction = { type: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: state.transform.x, originY: state.transform.y };
      svg.classList.add("is-panning");
    });
    svg.addEventListener("pointermove", handlePointerMove);
    svg.addEventListener("pointerup", endPointerInteraction);
    svg.addEventListener("pointercancel", endPointerInteraction);
    svg.addEventListener("wheel", handleWheel, { passive: false });
    svg.addEventListener("click", (event) => {
      if (event.target === svg || event.target.id === "viewport") {
        state.selectedId = null;
        renderDetails(null);
        updateEmphasis();
      }
    });
  }

  function startNodeDrag(event) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const group = event.currentTarget;
    const id = group.dataset.nodeId;
    const position = state.positions.get(id);
    group.setPointerCapture(event.pointerId);
    state.interaction = { type: "node", pointerId: event.pointerId, id, startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
  }

  function handlePointerMove(event) {
    const interaction = state.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.type === "pan") {
      state.transform.x = interaction.originX + event.clientX - interaction.startX;
      state.transform.y = interaction.originY + event.clientY - interaction.startY;
      updateTransform();
    } else if (interaction.type === "node") {
      const dx = (event.clientX - interaction.startX) / state.transform.scale;
      const dy = (event.clientY - interaction.startY) / state.transform.scale;
      state.positions.set(interaction.id, { x: interaction.originX + dx, y: interaction.originY + dy });
      updateNodeAndEdges(interaction.id);
    }
  }

  function endPointerInteraction(event) {
    if (!state.interaction || state.interaction.pointerId !== event.pointerId) return;
    state.interaction = null;
    el["architecture-graph"].classList.remove("is-panning");
  }

  function updateNodeAndEdges(id) {
    const position = state.positions.get(id);
    const group = [...el.nodes.querySelectorAll(".node")].find((item) => item.dataset.nodeId === id);
    if (group) group.setAttribute("transform", `translate(${position.x} ${position.y})`);
    el.edges.querySelectorAll(".edge").forEach((path) => {
      const edge = state.data.edges.find((item) => item.id === path.dataset.edgeId);
      if (edge.source === id || edge.target === id) {
        path.setAttribute("d", edgePath(state.positions.get(edge.source), state.positions.get(edge.target)));
      }
    });
  }

  function handleWheel(event) {
    event.preventDefault();
    const rect = el["architecture-graph"].getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const oldScale = state.transform.scale;
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    const newScale = Math.max(0.18, Math.min(2.8, oldScale * factor));
    const worldX = (pointerX - state.transform.x) / oldScale;
    const worldY = (pointerY - state.transform.y) / oldScale;
    state.transform.scale = newScale;
    state.transform.x = pointerX - worldX * newScale;
    state.transform.y = pointerY - worldY * newScale;
    updateTransform();
  }

  function updateTransform() {
    const { x, y, scale } = state.transform;
    el.viewport.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
  }

  function fitGraph() {
    if (!state.visibleIds.size) return;
    const rect = el["graph-wrap"].getBoundingClientRect();
    const padding = 30;
    const scale = Math.max(0.18, Math.min(1.25, Math.min((rect.width - padding * 2) / state.world.width, (rect.height - padding * 2) / state.world.height)));
    state.transform.scale = scale;
    state.transform.x = (rect.width - state.world.width * scale) / 2;
    state.transform.y = Math.max(padding, (rect.height - state.world.height * scale) / 2);
    updateTransform();
  }

  function centerNode(id) {
    const position = state.positions.get(id);
    if (!position) return;
    const rect = el["graph-wrap"].getBoundingClientRect();
    const scale = Math.max(state.transform.scale, 0.8);
    state.transform.scale = scale;
    state.transform.x = rect.width / 2 - (position.x + 95) * scale;
    state.transform.y = rect.height / 2 - (position.y + 28) * scale;
    updateTransform();
  }

  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.dataset.theme !== "dark";
    root.dataset.theme = dark ? "dark" : "light";
    el["theme-toggle"].textContent = dark ? "Light mode" : "Dark mode";
    el["theme-toggle"].setAttribute("aria-pressed", String(dark));
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function showFatal(error) {
    cacheElements();
    el["dataset-summary"].textContent = "Architecture data could not be loaded";
    el["graph-empty"].hidden = false;
    el["graph-empty"].textContent = `Start a local web server in project-architecture and reload. ${error.message}`;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    cacheElements();
    try {
      initialize(await loadData());
    } catch (error) {
      showFatal(error);
    }
  });
}());
