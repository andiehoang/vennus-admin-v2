/* =================================================================
   VENNUS ADMIN — App
   A small hash-router SPA, vanilla JS, no build step. Each route has
   a render(container, params) function; state lives in `state` below.
   ================================================================= */
(function () {
  const TOKEN_KEY = "vennus_admin_token";
  // Media URLs are stored as paths relative to the vennus-jewelry repo
  // root (e.g. "images/foo.webp") — exactly what the storefront's own
  // pages use directly, since they're served from that same repo. This
  // admin runs on a different domain, so anywhere a thumbnail needs
  // showing, it has to be resolved against where that repo is actually
  // published (GitHub Pages), not against the admin's own origin.
  const STOREFRONT_BASE = "https://andiehoang.github.io/vennus-jewelry/";
  const mediaSrc = (url) => STOREFRONT_BASE + String(url || "").replace(/^\/+/, "");
  // Inline style so an admin preview matches the real crop (position +
  // zoom) instead of just showing the raw, uncropped file.
  const mediaStyle = (m) => {
    if (!m) return "";
    const position = m.position || "center center";
    const zoomPart = m.zoom && m.zoom !== 1 ? ` transform:scale(${m.zoom}); transform-origin:${position};` : "";
    return `object-fit:cover; object-position:${position};${zoomPart}`;
  };
  const state = { user: null, products: [], media: [], settings: {} };

  /* ---------- fetch helper ---------- */
  async function api(path, opts = {}) {
    const token = localStorage.getItem(TOKEN_KEY);
    const isForm = opts.body instanceof FormData;
    const headers = Object.assign(isForm ? {} : { "Content-Type": "application/json" }, opts.headers || {});
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch("/api" + path, { ...opts, headers });
    if (res.status === 401) { signOut(); throw new Error("Session expired — please sign in again."); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  /* ---------- tiny DOM helpers ---------- */
  function h(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function money(n) { return "$" + Number(n || 0).toLocaleString("en-CA", { maximumFractionDigits: 0 }); }
  function dateShort(iso) { return iso ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "—"; }

  function toast(msg, isError) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast" + (isError ? " error" : "");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function closeModal() {
    document.getElementById("modalOverlay").hidden = true;
    document.getElementById("modalBox").innerHTML = "";
  }
  function openModal(innerHTML) {
    document.getElementById("modalBox").innerHTML = innerHTML;
    document.getElementById("modalOverlay").hidden = false;
  }
  function confirmModal(title, body, confirmLabel) {
    return new Promise(resolve => {
      openModal(`
        <h3>${esc(title)}</h3>
        <p>${esc(body)}</p>
        <div class="modal-actions">
          <button type="button" class="btn" id="mCancel">Cancel</button>
          <button type="button" class="btn btn-danger" id="mConfirm">${esc(confirmLabel || "Confirm")}</button>
        </div>`);
      document.getElementById("mCancel").onclick = () => { closeModal(); resolve(false); };
      document.getElementById("mConfirm").onclick = () => { closeModal(); resolve(true); };
    });
  }

  document.getElementById("modalOverlay").addEventListener("click", e => {
    if (e.target.id === "modalOverlay") closeModal();
  });

  /* ---------- media pick + crop helper (used by Settings + Product edit) ----------
     Two steps: choose/upload a file, then frame it — real drag-to-pan,
     scroll-to-zoom, against the exact aspect ratio it will render at.
     This is the same tool (and the same math) as the pencil directly
     on the storefront, so a crop made here looks identical there and
     vice versa.
       aspectRatio   — width/height number the crop frame should match
       existingMedia — { url, type, position, zoom } to jump straight
                        to the crop step on an already-chosen file
       onPick(media) — called with { url, type, position, zoom } */
  function pickMedia({ aspectRatio, existingMedia, onPick }) {
    const listHTML = state.media.map(m => `
      <div class="media-item" data-url="${esc(m.url)}" data-type="${m.type}" style="cursor:pointer;">
        ${m.type === "video" ? `<video src="${esc(mediaSrc(m.url))}" muted></video>` : `<img src="${esc(mediaSrc(m.url))}">`}
      </div>`).join("") || `<p class="panel-empty">Nothing uploaded yet — use the box below.</p>`;

    openModal(`
      <h3>${existingMedia ? "Adjust framing" : "Choose an image or video"}</h3>
      <div id="pickStep1">
        <p>Pick something already in your library, or upload something new.</p>
        <div class="media-grid" id="pickGrid" style="max-height:280px; overflow-y:auto; margin-bottom:16px;">${listHTML}</div>
        <div class="dropzone" id="pickDrop">Drag a file here, or
          <label>choose a file<input type="file" id="pickFile" accept="image/*,video/*" style="display:none;"></label>
        </div>
      </div>
      <div id="pickStep2" style="display:none;">
        <p style="font-size:.85rem; font-weight:500;">Drag to reposition, scroll (or use the buttons) to zoom</p>
        <div class="crop-frame" id="cropFrame" style="${aspectRatio ? `aspect-ratio:${aspectRatio};` : ""}"></div>
        <div class="crop-controls">
          <button type="button" class="zoom-btn" id="zoomOut">&minus;</button>
          <input type="range" id="zoomSlider" min="100" max="300" value="100" step="1">
          <button type="button" class="zoom-btn" id="zoomIn">+</button>
        </div>
        <p class="crop-hint">This is exactly how it will be framed on the site.</p>
        <div class="modal-actions" style="justify-content:flex-start;">
          <button type="button" class="btn btn-primary" id="saveCrop">Save</button>
          ${existingMedia ? "" : '<button type="button" class="btn" id="backToStep1">Choose a different file</button>'}
          <button type="button" class="btn" id="resetCrop">Reset</button>
        </div>
      </div>
    `);

    document.querySelectorAll("#pickGrid .media-item").forEach(item => {
      item.onclick = () => showStep2({ url: item.dataset.url, type: item.dataset.type });
    });
    const dz = document.getElementById("pickDrop");
    ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("hot"); }));
    ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("hot"); }));
    dz.addEventListener("drop", e => uploadThenCrop(e.dataTransfer.files));
    document.getElementById("pickFile").addEventListener("change", e => uploadThenCrop(e.target.files));

    async function uploadThenCrop(files) {
      if (!files || !files[0]) return;
      const fd = new FormData();
      fd.append("files", files[0]);
      try {
        const r = await api("/media", { method: "POST", body: fd });
        state.media.unshift(r.files[0]);
        showStep2(r.files[0]);
      } catch (err) { toast(err.message, true); }
    }

    let pending = null;
    let posX = 50, posY = 50, zoom = 1;

    function showStep2(media) {
      pending = media;
      const parsed = media.position && /(\d+(\.\d+)?)% (\d+(\.\d+)?)%/.exec(media.position);
      posX = parsed ? +parsed[1] : 50;
      posY = parsed ? +parsed[3] : 50;
      zoom = media.zoom || 1;

      document.getElementById("pickStep1").style.display = "none";
      document.getElementById("pickStep2").style.display = "block";

      const frame = document.getElementById("cropFrame");
      frame.innerHTML = media.type === "video"
        ? `<video src="${esc(mediaSrc(media.url))}" muted loop autoplay playsinline></video>`
        : `<img src="${esc(mediaSrc(media.url))}" draggable="false">`;
      renderTransform();
      wireCropInteraction(frame);
    }

    function renderTransform() {
      const media = document.querySelector("#cropFrame img, #cropFrame video");
      if (!media) return;
      media.style.objectPosition = `${posX}% ${posY}%`;
      media.style.transform = zoom !== 1 ? `scale(${zoom})` : "";
      media.style.transformOrigin = `${posX}% ${posY}%`;
      document.getElementById("zoomSlider").value = Math.round(zoom * 100);
    }

    function setZoom(newZoom) {
      zoom = Math.min(3, Math.max(1, newZoom));
      renderTransform();
    }

    function wireCropInteraction(frame) {
      let dragging = false, lastX = 0, lastY = 0;
      const onDown = (clientX, clientY) => { dragging = true; lastX = clientX; lastY = clientY; frame.classList.add("dragging"); };
      const onMove = (clientX, clientY) => {
        if (!dragging) return;
        const rect = frame.getBoundingClientRect();
        const dxPct = ((clientX - lastX) / rect.width) * 100 / zoom;
        const dyPct = ((clientY - lastY) / rect.height) * 100 / zoom;
        posX = Math.min(100, Math.max(0, posX - dxPct));
        posY = Math.min(100, Math.max(0, posY - dyPct));
        lastX = clientX; lastY = clientY;
        renderTransform();
      };
      const onUp = () => { dragging = false; frame.classList.remove("dragging"); };

      frame.addEventListener("mousedown", e => { e.preventDefault(); onDown(e.clientX, e.clientY); });
      window.addEventListener("mousemove", e => onMove(e.clientX, e.clientY));
      window.addEventListener("mouseup", onUp);
      frame.addEventListener("touchstart", e => { const t = e.touches[0]; onDown(t.clientX, t.clientY); }, { passive: true });
      frame.addEventListener("touchmove", e => { const t = e.touches[0]; onMove(t.clientX, t.clientY); }, { passive: true });
      frame.addEventListener("touchend", onUp);
      frame.addEventListener("wheel", e => { e.preventDefault(); setZoom(zoom - e.deltaY * 0.0015); }, { passive: false });
    }

    document.getElementById("zoomIn").onclick = () => setZoom(zoom + 0.2);
    document.getElementById("zoomOut").onclick = () => setZoom(zoom - 0.2);
    document.getElementById("zoomSlider").addEventListener("input", e => setZoom(e.target.value / 100));
    document.getElementById("resetCrop").onclick = () => { posX = 50; posY = 50; zoom = 1; renderTransform(); };
    document.getElementById("backToStep1")?.addEventListener("click", () => {
      document.getElementById("pickStep1").style.display = "block";
      document.getElementById("pickStep2").style.display = "none";
    });
    document.getElementById("saveCrop").onclick = () => {
      onPick({ url: pending.url, type: pending.type, position: `${posX}% ${posY}%`, zoom });
      closeModal();
    };

    // Re-framing an already-chosen photo — skip straight to the crop step.
    if (existingMedia) showStep2(existingMedia);
  }

  /* =================================================================
     ROUTES
     ================================================================= */
  const routes = [
    { path: "/", title: "Dashboard", render: renderDashboard },
    { path: "/products", title: "Products", render: renderProductsList },
    { path: "/products/new", title: "New Product", render: c => renderProductForm(c, null) },
    { path: "/products/:id", title: "Edit Product", render: (c, p) => renderProductForm(c, p.id) },
    { path: "/media", title: "Media Library", render: renderMedia },
    { path: "/settings", title: "Site Settings", render: renderSettings },
    { path: "/orders", title: "Orders", render: renderOrders },
    { path: "/customers", title: "Customers", render: renderCustomers },
    { path: "/users", title: "Staff", render: renderUsers }
  ];

  function matchRoute(hash) {
    const path = (hash.replace(/^#/, "") || "/").split("?")[0];
    for (const r of routes) {
      const parts = r.path.split("/"), given = path.split("/");
      if (parts.length !== given.length) continue;
      const params = {};
      const ok = parts.every((seg, i) => {
        if (seg.startsWith(":")) { params[seg.slice(1)] = given[i]; return true; }
        return seg === given[i];
      });
      if (ok) return { route: r, params };
    }
    return null;
  }

  async function router() {
    const match = matchRoute(location.hash);
    const content = document.getElementById("content");
    if (!match) { content.innerHTML = `<div class="empty-state">Page not found.</div>`; return; }

    document.getElementById("pageTitle").textContent = match.route.title;
    document.querySelectorAll(".side-nav a").forEach(a => {
      a.classList.toggle("active", a.dataset.route === match.route.path.split("/:")[0].replace(/\/new$/, "") || (a.getAttribute("href") === "#" + location.hash.replace(/^#/, "")));
    });
    // Simpler, reliable active-state: match by top-level section.
    const section = "/" + (location.hash.replace(/^#\//, "").split("/")[0] || "");
    document.querySelectorAll(".side-nav a").forEach(a => a.classList.toggle("active", a.dataset.route === section));

    closeSidebar();
    content.innerHTML = `<div class="empty-state">Loading…</div>`;
    try {
      await match.route.render(content, match.params);
    } catch (err) {
      content.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
    }
  }
  window.addEventListener("hashchange", router);

  /* ---------- sidebar (mobile drawer) ---------- */
  function openSidebar() { document.getElementById("sidebar").classList.add("open"); document.getElementById("sidebarBackdrop").classList.add("open"); }
  function closeSidebar() { document.getElementById("sidebar").classList.remove("open"); document.getElementById("sidebarBackdrop").classList.remove("open"); }
  document.getElementById("openSidebar").addEventListener("click", openSidebar);
  document.getElementById("sidebarBackdrop").addEventListener("click", closeSidebar);

  /* =================================================================
     DASHBOARD
     ================================================================= */
  async function renderDashboard(content) {
    const [summary, orders] = await Promise.all([api("/analytics/summary"), api("/orders")]);
    content.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="label">Products</div><div class="value">${summary.productCount}</div></div>
        <div class="kpi-card"><div class="label">Orders</div><div class="value">${summary.orderCount}</div></div>
        <div class="kpi-card"><div class="label">Revenue</div><div class="value">${money(summary.revenue)}</div></div>
        <div class="kpi-card"><div class="label">Pageviews (30d)</div><div class="value">${summary.pageviews30d}</div></div>
      </div>
      <div class="two-col">
        <div class="panel">
          <h3>Low Stock</h3>
          ${summary.lowStock.length
            ? `<div class="table-scroll"><table class="data-table"><tbody>${summary.lowStock.map(p => `
                <tr><td>${esc(p.name)}</td><td class="num">${p.quantity} left</td></tr>`).join("")}</tbody></table></div>`
            : `<p class="panel-empty">Nothing running low.</p>`}
        </div>
        <div class="panel">
          <h3>Recent Orders</h3>
          ${orders.length
            ? `<div class="table-scroll"><table class="data-table"><tbody>${orders.slice(0, 5).map(o => `
                <tr><td>#${o.id}</td><td>${dateShort(o.createdAt)}</td><td class="num">${money(o.subtotal)}</td></tr>`).join("")}</tbody></table></div>`
            : `<p class="panel-empty">No orders yet.</p>`}
        </div>
      </div>
    `;
  }

  /* =================================================================
     PRODUCTS
     ================================================================= */
  function stockPill(p) {
    if (!p.inStock) return `<span class="pill pill-bad">Sold out</span>`;
    if (p.quantity <= 5) return `<span class="pill pill-warn">${p.quantity} left</span>`;
    return `<span class="pill pill-good">In stock</span>`;
  }

  async function renderProductsList(content) {
    state.products = await api("/products");
    let filter = "all", query = "";

    function draw() {
      const rows = state.products
        .filter(p => filter === "all" || p.category === filter)
        .filter(p => !query || p.name.toLowerCase().includes(query.toLowerCase()) || (p.sku || "").toLowerCase().includes(query.toLowerCase()));
      const cats = ["all", ...new Set(state.products.map(p => p.category))];

      content.innerHTML = `
        <div class="toolbar">
          <div class="chip-row">${cats.map(c => `<button type="button" class="chip${c === filter ? " active" : ""}" data-cat="${c}">${c === "all" ? "All" : esc(c)}</button>`).join("")}</div>
          <div style="display:flex; gap:10px;">
            <input type="search" class="search-input" id="productSearch" placeholder="Search name or SKU…" value="${esc(query)}">
            <a href="#/products/new" class="btn btn-primary">Add Product</a>
          </div>
        </div>
        ${rows.length ? `
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th></th></tr></thead>
            <tbody>${rows.map(p => `
              <tr class="clickable" data-id="${p.id}">
                <td>${esc(p.name)}${p.tag ? ` <span class="pill pill-muted">${esc(p.tag)}</span>` : ""}</td>
                <td>${esc(p.category)}</td>
                <td class="num">${money(p.price)}</td>
                <td>${stockPill(p)}</td>
                <td class="actions"><a href="#/products/${p.id}" class="btn btn-sm">Edit</a></td>
              </tr>`).join("")}</tbody>
          </table>
        </div>` : `<div class="empty-state">No products match.</div>`}
      `;
      content.querySelectorAll(".chip").forEach(b => b.onclick = () => { filter = b.dataset.cat; draw(); });
      content.querySelector("#productSearch").oninput = e => { query = e.target.value; draw(); };
      content.querySelectorAll("tr.clickable").forEach(tr => tr.onclick = e => {
        if (!e.target.closest("a")) location.hash = "#/products/" + tr.dataset.id;
      });
    }
    draw();
  }

  async function renderProductForm(content, id) {
    const isNew = !id;
    const product = isNew
      ? { name: "", category: "necklaces", price: 0, compareAt: null, tag: null, sku: "", images: [], description: "", details: [], options: null, inStock: true, quantity: 0 }
      : await api("/products/" + id);
    if (!state.media.length) state.media = await api("/media").catch(() => []);

    let details = [...product.details];
    let images = [...product.images];
    let hasOptions = !!product.options;

    function fieldsHTML() {
      return `
        <div class="panel">
          <h3>Details</h3>
          <div class="form-row">
            <div class="field"><label>Name</label><input id="fName" value="${esc(product.name)}"></div>
            <div class="field"><label>Category</label>
              <select id="fCategory">
                ${["necklaces", "earrings", "bracelets", "rings"].map(c => `<option value="${c}" ${product.category === c ? "selected" : ""}>${c}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="field"><label>Price (CAD)</label><input id="fPrice" type="number" min="0" step="1" value="${product.price}"></div>
            <div class="field"><label>Compare-at price</label><input id="fCompareAt" type="number" min="0" step="1" value="${product.compareAt ?? ""}"><span class="hint">Leave blank if not on sale.</span></div>
          </div>
          <div class="form-row">
            <div class="field"><label>SKU</label><input id="fSku" value="${esc(product.sku)}"></div>
            <div class="field"><label>Tag</label>
              <select id="fTag">
                <option value="" ${!product.tag ? "selected" : ""}>None</option>
                <option value="new" ${product.tag === "new" ? "selected" : ""}>New</option>
                <option value="bestseller" ${product.tag === "bestseller" ? "selected" : ""}>Bestseller</option>
                <option value="sale" ${product.tag === "sale" ? "selected" : ""}>Sale</option>
              </select>
            </div>
          </div>
          <div class="field"><label>Description</label><textarea id="fDescription">${esc(product.description)}</textarea></div>
        </div>

        <div class="panel">
          <h3>Details List</h3>
          <div class="details-list-editor" id="detailsEditor">
            ${details.map((d, i) => `<div class="detail-row"><input value="${esc(d)}" data-i="${i}"><button type="button" class="btn btn-sm" data-rm="${i}">Remove</button></div>`).join("")}
          </div>
          <button type="button" class="btn btn-sm" id="addDetail">+ Add line</button>
        </div>

        <div class="panel">
          <h3>Option (e.g. chain length)</h3>
          <div class="checkbox-row"><input type="checkbox" id="fHasOptions" ${hasOptions ? "checked" : ""}><label for="fHasOptions">This product has a choosable option</label></div>
          <div id="optionFields" style="${hasOptions ? "" : "display:none;"}">
            <div class="field"><label>Option label</label><input id="fOptionLabel" value="${esc(product.options?.label || "")}"></div>
            <div class="field"><label>Values (comma-separated)</label><input id="fOptionValues" value="${esc((product.options?.values || []).join(", "))}"></div>
          </div>
        </div>

        <div class="panel">
          <h3>Stock</h3>
          <div class="form-row">
            <div class="checkbox-row"><input type="checkbox" id="fInStock" ${product.inStock ? "checked" : ""}><label for="fInStock">In stock</label></div>
            <div class="field"><label>Quantity on hand</label><input id="fQuantity" type="number" min="0" value="${product.quantity}"></div>
          </div>
        </div>

        <div class="panel">
          <h3>Photos &amp; Video</h3>
          <div class="product-photo-row" id="photoRow">
            ${images.map((m, i) => `
              <div class="thumb" data-i="${i}">
                ${m.type === "video" ? `<video src="${esc(mediaSrc(m.url))}" muted style="${mediaStyle(m)}"></video>` : `<img src="${esc(mediaSrc(m.url))}" style="${mediaStyle(m)}">`}
                <button type="button" data-rm="${i}" title="Remove">×</button>
              </div>`).join("")}
          </div>
          ${images.length ? `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">${images.map((m, i) => `<button type="button" class="btn btn-sm" data-crop="${i}">Crop photo ${i + 1}</button>`).join("")}</div>` : ""}
          <button type="button" class="btn btn-sm" id="addPhoto">+ Add from library / upload</button>
          <p class="photo-note">New photos are cropped to the product page's own frame (4:5) right when you add them — drag to reposition, scroll or use the buttons to zoom. Use "Crop photo N" above to re-frame one already here.</p>
        </div>

        <div class="modal-actions" style="justify-content:flex-start;">
          <button type="button" class="btn btn-primary" id="saveProduct">${isNew ? "Create Product" : "Save Changes"}</button>
          ${!isNew ? `<button type="button" class="btn btn-danger" id="deleteProduct">Delete</button>` : ""}
          <a href="#/products" class="btn">Cancel</a>
        </div>
      `;
    }

    function wire() {
      content.querySelector("#addDetail").onclick = () => { details.push(""); redraw(); };
      content.querySelectorAll("[data-rm]").forEach(b => {
        b.onclick = () => {
          if (b.closest("#detailsEditor")) details.splice(+b.dataset.rm, 1);
          else images.splice(+b.closest(".thumb").dataset.i, 1);
          redraw();
        };
      });
      content.querySelectorAll("#detailsEditor input").forEach(inp => inp.oninput = () => { details[+inp.dataset.i] = inp.value; });
      content.querySelector("#fHasOptions").onchange = e => {
        hasOptions = e.target.checked;
        content.querySelector("#optionFields").style.display = hasOptions ? "" : "none";
      };
      content.querySelector("#addPhoto").onclick = () => pickMedia({
        aspectRatio: 4 / 5,
        onPick: (m) => { images.push(m); redraw(); }
      });
      content.querySelectorAll("[data-crop]").forEach(b => b.onclick = () => {
        const i = +b.dataset.crop;
        pickMedia({
          aspectRatio: 4 / 5,
          existingMedia: images[i],
          onPick: (m) => { images[i] = m; redraw(); }
        });
      });

      content.querySelector("#saveProduct").onclick = async () => {
        const body = {
          name: content.querySelector("#fName").value.trim(),
          category: content.querySelector("#fCategory").value,
          price: +content.querySelector("#fPrice").value,
          compareAt: content.querySelector("#fCompareAt").value === "" ? null : +content.querySelector("#fCompareAt").value,
          sku: content.querySelector("#fSku").value.trim(),
          tag: content.querySelector("#fTag").value || null,
          description: content.querySelector("#fDescription").value,
          details: details.filter(d => d.trim()),
          options: hasOptions ? {
            label: content.querySelector("#fOptionLabel").value.trim() || "Option",
            values: content.querySelector("#fOptionValues").value.split(",").map(v => v.trim()).filter(Boolean)
          } : null,
          inStock: content.querySelector("#fInStock").checked,
          quantity: +content.querySelector("#fQuantity").value,
          images
        };
        if (!body.name) return toast("A name is required.", true);
        try {
          if (isNew) { const p = await api("/products", { method: "POST", body: JSON.stringify(body) }); toast("Product created."); location.hash = "#/products/" + p.id; }
          else { await api("/products/" + id, { method: "PUT", body: JSON.stringify(body) }); toast("Saved."); }
        } catch (err) { toast(err.message, true); }
      };

      const del = content.querySelector("#deleteProduct");
      if (del) del.onclick = async () => {
        if (!(await confirmModal("Delete this product?", `"${product.name}" will be removed from the storefront immediately.`, "Delete"))) return;
        try { await api("/products/" + id, { method: "DELETE" }); toast("Deleted."); location.hash = "#/products"; }
        catch (err) { toast(err.message, true); }
      };
    }

    function redraw() { content.innerHTML = fieldsHTML(); wire(); }
    redraw();
  }

  /* =================================================================
     MEDIA LIBRARY
     ================================================================= */
  async function renderMedia(content) {
    state.media = await api("/media");
    function draw() {
      content.innerHTML = `
        <div class="dropzone" id="mediaDrop">Drag photos or video here, or
          <label>choose files<input type="file" id="mediaFile" accept="image/*,video/*" multiple style="display:none;"></label>
        </div>
        ${state.media.length ? `
        <div class="media-grid">
          ${state.media.map(m => `
            <div class="media-item">
              ${m.type === "video" ? `<video src="${esc(mediaSrc(m.url))}" muted></video>` : `<img src="${esc(mediaSrc(m.url))}" loading="lazy">`}
              <button type="button" class="copy-btn" data-url="${esc(m.url)}">Copy path</button>
            </div>`).join("")}
        </div>` : `<div class="empty-state">Nothing uploaded yet.</div>`}
      `;
      const dz = content.querySelector("#mediaDrop");
      ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("hot"); }));
      ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("hot"); }));
      dz.addEventListener("drop", e => upload(e.dataTransfer.files));
      content.querySelector("#mediaFile").addEventListener("change", e => upload(e.target.files));
      content.querySelectorAll(".copy-btn").forEach(b => b.onclick = () => {
        navigator.clipboard?.writeText(b.dataset.url).then(() => toast("Path copied."));
      });
    }
    async function upload(files) {
      if (!files || !files.length) return;
      const fd = new FormData();
      [...files].forEach(f => fd.append("files", f));
      try {
        const r = await api("/media", { method: "POST", body: fd });
        state.media = [...r.files, ...state.media];
        toast(`${r.files.length} file(s) uploaded.`);
        draw();
      } catch (err) { toast(err.message, true); }
    }
    draw();
  }

  /* =================================================================
     SETTINGS
     ================================================================= */
  const IMAGE_SLOTS = [
    { key: "hero_home", label: "Homepage Hero", aspect: 16 / 9 },
    { key: "hero_maison", label: "Maison Hero", aspect: 16 / 9 },
    { key: "category_necklaces", label: "Category Tile — Necklaces", aspect: 1 },
    { key: "category_earrings", label: "Category Tile — Earrings", aspect: 1 },
    { key: "category_bracelets", label: "Category Tile — Bracelets", aspect: 1 },
    { key: "category_rings", label: "Category Tile — Rings", aspect: 1 },
    { key: "home_editorial_1", label: "Homepage Editorial 1", aspect: 1000 / 1200 },
    { key: "home_editorial_2", label: "Homepage Editorial 2", aspect: 1000 / 1200 },
    { key: "maison_editorial_1", label: "Maison Editorial 1", aspect: 1000 / 1200 },
    { key: "maison_editorial_2", label: "Maison Editorial 2", aspect: 1000 / 1200 },
    { key: "mega_feature_jewelry", label: "Menu Feature — Jewelry", aspect: 760 / 570 },
    { key: "mega_feature_maison", label: "Menu Feature — Maison", aspect: 760 / 570 }
  ];
  const THEME_KEYS = [
    { key: "blanc", label: "Blanc (background)" }, { key: "craie", label: "Craie (panels)" },
    { key: "sand", label: "Sand (accent)" }, { key: "chai", label: "Chai (hover/links)" },
    { key: "beton", label: "Beton (muted text)" }, { key: "umber", label: "Umber (headings)" },
    { key: "blush", label: "Blush (small accents)" }, { key: "champagne", label: "Champagne (gold hover)" }
  ];

  async function renderSettings(content) {
    state.settings = await api("/settings");
    if (!state.media.length) state.media = await api("/media").catch(() => []);
    const s = state.settings;

    content.innerHTML = `
      <div class="panel">
        <h3>Announcement Bar &amp; SEO</h3>
        <div class="field"><label>Announcement bar text</label><input id="sAnnouncement" value="${esc(s.announcement || "")}"></div>
        <div class="field"><label>Search description (SEO)</label><textarea id="sSeo">${esc(s.seo_description || "")}</textarea></div>
        <button type="button" class="btn btn-primary" id="saveText">Save</button>
      </div>

      <div class="panel">
        <h3>Hero &amp; Editorial Images</h3>
        <div class="setting-image-grid">
          ${IMAGE_SLOTS.map(slot => {
            const m = s[slot.key];
            return `
            <div class="setting-image-card" data-key="${slot.key}">
              <div class="setting-image-preview">
                ${m ? (m.type === "video"
                  ? `<video src="${esc(mediaSrc(m.url))}" muted style="${mediaStyle(m)}"></video>`
                  : `<img src="${esc(mediaSrc(m.url))}" style="${mediaStyle(m)}">`)
                  : `<div class="empty-note">No image set — storefront shows its placeholder</div>`}
              </div>
              <div class="setting-image-label">${slot.label}</div>
              <div class="setting-image-actions">
                <button type="button" class="btn btn-sm" data-choose="${slot.key}">Choose</button>
                ${m ? `<button type="button" class="btn btn-sm" data-crop="${slot.key}">Crop</button>` : ""}
                ${m ? `<button type="button" class="btn btn-sm btn-danger" data-clear="${slot.key}">Clear</button>` : ""}
              </div>
            </div>`;
          }).join("")}
        </div>
        <p class="photo-note">Choosing or uploading an image opens the crop tool right away — drag to reposition, scroll or use the buttons to zoom, matched to this spot's own shape.</p>
      </div>

      <div class="panel">
        <h3>Theme Colours</h3>
        <div class="color-grid">
          ${THEME_KEYS.map(t => `
            <div class="color-field">
              <input type="color" id="theme_${t.key}" value="${(s.theme && s.theme[t.key]) || "#000000"}">
              <span class="color-name">${t.label}</span>
            </div>`).join("")}
        </div>
        <p class="field .hint" style="margin-top:10px; font-size:0.8rem; color:var(--beton);">Leave a swatch alone to keep the storefront's default for that colour.</p>
        <button type="button" class="btn btn-primary" style="margin-top:12px;" id="saveTheme">Save Theme</button>
      </div>
    `;

    content.querySelector("#saveText").onclick = async () => {
      try {
        await api("/settings", { method: "PUT", body: JSON.stringify({ announcement: content.querySelector("#sAnnouncement").value, seo_description: content.querySelector("#sSeo").value }) });
        toast("Saved.");
      } catch (err) { toast(err.message, true); }
    };

    async function saveSlot(key, media) {
      try {
        const updated = await api("/settings", { method: "PUT", body: JSON.stringify({ [key]: media }) });
        state.settings = updated;
        renderSettings(content);
        toast("Saved.");
      } catch (err) { toast(err.message, true); }
    }
    content.querySelectorAll("[data-choose]").forEach(b => b.onclick = () => {
      const slot = IMAGE_SLOTS.find(s2 => s2.key === b.dataset.choose);
      pickMedia({ aspectRatio: slot.aspect, onPick: (m) => saveSlot(slot.key, m) });
    });
    content.querySelectorAll("[data-crop]").forEach(b => b.onclick = () => {
      const slot = IMAGE_SLOTS.find(s2 => s2.key === b.dataset.crop);
      pickMedia({ aspectRatio: slot.aspect, existingMedia: s[slot.key], onPick: (m) => saveSlot(slot.key, m) });
    });
    content.querySelectorAll("[data-clear]").forEach(b => b.onclick = async () => {
      try {
        const updated = await api("/settings", { method: "PUT", body: JSON.stringify({ [b.dataset.clear]: null }) });
        state.settings = updated;
        renderSettings(content);
      } catch (err) { toast(err.message, true); }
    });

    content.querySelector("#saveTheme").onclick = async () => {
      const theme = {};
      THEME_KEYS.forEach(t => { theme[t.key] = content.querySelector("#theme_" + t.key).value; });
      try { await api("/settings", { method: "PUT", body: JSON.stringify({ theme }) }); toast("Theme saved."); }
      catch (err) { toast(err.message, true); }
    };
  }

  /* =================================================================
     ORDERS / CUSTOMERS
     ================================================================= */
  async function renderOrders(content) {
    const orders = await api("/orders");
    content.innerHTML = orders.length ? `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Subtotal</th><th>Status</th></tr></thead>
          <tbody>${orders.map(o => `
            <tr>
              <td>#${o.id}</td>
              <td>${dateShort(o.createdAt)}</td>
              <td>${esc(o.customer?.email || o.customer?.name || "—")}</td>
              <td>${o.items.map(i => `${i.quantity}× ${esc(i.name)}`).join(", ")}</td>
              <td class="num">${money(o.subtotal)}</td>
              <td><span class="pill pill-muted">${esc(o.status)}</span></td>
            </tr>`).join("")}</tbody>
        </table>
      </div>` : `<div class="empty-state">No orders yet.</div>`;
  }

  async function renderCustomers(content) {
    const subs = await api("/subscribers");
    content.innerHTML = subs.length ? `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Email</th><th>Joined</th><th>Source</th></tr></thead>
          <tbody>${subs.map(s => `
            <tr><td>${esc(s.email)}</td><td>${dateShort(s.subscribedAt)}</td><td>${s.fromOrder ? `Order #${s.fromOrder}` : "Newsletter"}</td></tr>`).join("")}</tbody>
        </table>
      </div>` : `<div class="empty-state">No subscribers yet.</div>`;
  }

  /* =================================================================
     STAFF / USERS
     ================================================================= */
  async function renderUsers(content) {
    if (!["admin", "owner"].includes(state.user.role)) {
      content.innerHTML = `<div class="empty-state">Only admins and owners can manage staff.</div>`;
      return;
    }
    const users = await api("/users");
    const isOwner = state.user.role === "owner";

    function draw() {
      content.innerHTML = `
        ${isOwner ? `<div class="toolbar"><span></span><button type="button" class="btn btn-primary" id="addUser">Add Staff Account</button></div>` : ""}
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
            <tbody>${users.map(u => `
              <tr>
                <td>${esc(u.name)}</td>
                <td>${esc(u.email)}</td>
                <td><span class="pill pill-muted">${u.role}</span></td>
                <td class="actions">${isOwner ? `
                  <button type="button" class="btn btn-sm" data-edit="${u.id}">Edit</button>
                  <button type="button" class="btn btn-sm btn-danger" data-rm="${u.id}">Remove</button>` : ""}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>
      `;
      if (!isOwner) return;
      content.querySelector("#addUser").onclick = () => userFormModal(null, draw);
      content.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => userFormModal(users.find(u => u.id === +b.dataset.edit), draw));
      content.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => {
        const u = users.find(x => x.id === +b.dataset.rm);
        if (!(await confirmModal("Remove staff account?", `${u.email} will no longer be able to sign in.`, "Remove"))) return;
        try { await api("/users/" + u.id, { method: "DELETE" }); toast("Removed."); renderUsers(content); }
        catch (err) { toast(err.message, true); }
      });
    }
    draw();
  }

  function userFormModal(user, onDone) {
    const isNew = !user;
    openModal(`
      <h3>${isNew ? "Add Staff Account" : "Edit " + esc(user.name)}</h3>
      <div class="field"><label>Name</label><input id="uName" value="${isNew ? "" : esc(user.name)}"></div>
      ${isNew ? `<div class="field"><label>Email</label><input id="uEmail" type="email"></div>` : ""}
      <div class="field"><label>${isNew ? "Password" : "New password (leave blank to keep current)"}</label><input id="uPassword" type="password"></div>
      <div class="field"><label>Role</label>
        <select id="uRole">
          ${["viewer", "editor", "admin", "owner"].map(r => `<option value="${r}" ${user && user.role === r ? "selected" : ""}>${r}</option>`).join("")}
        </select>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="uCancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="uSave">${isNew ? "Create" : "Save"}</button>
      </div>
    `);
    document.getElementById("uCancel").onclick = closeModal;
    document.getElementById("uSave").onclick = async () => {
      const body = {
        name: document.getElementById("uName").value.trim(),
        role: document.getElementById("uRole").value,
        password: document.getElementById("uPassword").value || undefined
      };
      try {
        if (isNew) {
          body.email = document.getElementById("uEmail").value.trim();
          if (!body.password) return toast("A password is required.", true);
          await api("/users", { method: "POST", body: JSON.stringify(body) });
        } else {
          await api("/users/" + user.id, { method: "PUT", body: JSON.stringify(body) });
        }
        closeModal(); toast("Saved."); onDone();
      } catch (err) { toast(err.message, true); }
    };
  }

  /* =================================================================
     AUTH / BOOT
     ================================================================= */
  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    api("/auth/logout", { method: "POST" }).catch(() => {});
    document.getElementById("app").hidden = true;
    document.getElementById("loginScreen").hidden = false;
  }
  document.getElementById("signOutBtn").addEventListener("click", signOut);

  document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("loginError");
    errEl.textContent = "";
    try {
      const r = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("loginEmail").value,
          password: document.getElementById("loginPassword").value
        })
      });
      localStorage.setItem(TOKEN_KEY, r.token);
      boot(r.user);
    } catch (err) { errEl.textContent = err.message; }
  });

  function applyRoleVisibility(role) {
    document.querySelectorAll(".owner-only").forEach(el => {
      el.style.display = ["admin", "owner"].includes(role) ? "" : "none";
    });
  }

  function boot(user) {
    state.user = user;
    document.getElementById("loginScreen").hidden = true;
    document.getElementById("app").hidden = false;
    document.getElementById("topbarUserName").textContent = user.name;
    document.getElementById("topbarUserRole").textContent = user.role;
    applyRoleVisibility(user.role);
    if (!location.hash) location.hash = "#/";
    router();
  }

  (async function start() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return; // login screen is the default visible state
    try {
      const r = await api("/auth/me");
      boot(r.user);
    } catch { signOut(); }
  })();
})();
