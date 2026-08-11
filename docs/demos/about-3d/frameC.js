  // ---------- FRAME C — a 3D force-directed graph of the whole องค์กร ----------
  //
  // Same idea as vasturiano's 3d-force-graph tree example: nodes repel, links
  // pull, and the tree finds its own shape in space instead of being placed on
  // a grid by hand. The physics here is written directly rather than pulled in
  // from d3-force-3d — 669 nodes with a spatial hash is a page of code, and the
  // page is already carrying three.js.
  //
  // Every person is a CARD, and every card is a slice of one baked atlas: the
  // photo when there is one, a default profile picture when there is not, with
  // the Thai name drawn by the browser's own text engine before it ever became
  // a texture.
  const stage = document.getElementById('frameC');
  const boot = document.getElementById('cBoot');
  let started = false;

  function start3d() {
    if (started) return;
    started = true;
    boot.remove();
    document.getElementById('cHint').hidden = false;

    const THREE = window.THREE;
    const CARDS = window.CARD_DATA;
    const W = () => stage.clientWidth;
    const H = () => stage.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.5, 20000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W(), H());
    stage.appendChild(renderer.domElement);

    const css = getComputedStyle(document.documentElement);
    const tintHex = (t) => (css.getPropertyValue(`--dept-${t}`).trim() || '#8C6A47');

    // ---- graph: root → ฝ่าย → ตำแหน่ง → คน ----
    const nodes = [];
    const links = [];
    const addNode = (o) => { o.id = nodes.length; nodes.push(o); return o; };

    const root = addNode({
      kind: 'root', label: 'สโมสรนักศึกษาฯ', tint: 'strategy', r: 5, level: 0, dept: -1,
    });
    let cardIndex = 0;
    let maxLevel = 0;
    let deptIndex = -1;
    const walk = (n, dept, parent, depth) => {
      const level = parent.level + 1;
      maxLevel = Math.max(maxLevel, level);
      const self = addNode({
        kind: 'role', label: n.name, tint: dept.tint, r: Math.max(1.6, 4 - depth),
        role: n.name, dept: dept.name, level, di: deptIndex,
      });
      links.push([parent.id, self.id, depth === 0 ? 70 : 34 - depth * 4]);
      for (const p of n.people) {
        const card = CARDS.cards[cardIndex];
        const person = addNode({
          kind: 'person', tint: dept.tint, r: 3.2, card: cardIndex,
          label: p.n, nick: p.k, role: n.name, dept: dept.name, path: card ? card.path : '',
          level: level + 1, di: deptIndex,
        });
        maxLevel = Math.max(maxLevel, level + 1);
        cardIndex++;
        links.push([self.id, person.id, 22]);
      }
      for (const kid of n.kids) walk(kid, dept, self, depth + 1);
    };
    for (const dept of DATA.roots) { deptIndex++; walk(dept, dept, root, 0); }

    const persons = nodes.filter((n) => n.kind === 'person');
    const structs = nodes.filter((n) => n.kind !== 'person');

    // ---- initial positions: a radial tree, so the simulation relaxes an
    // already-sensible shape instead of untangling a random cloud ----
    const fib = (i, n) => {
      const k = i + 0.5;
      const phi = Math.acos(1 - 2 * k / n);
      const theta = Math.PI * (1 + Math.sqrt(5)) * k;
      return [Math.cos(theta) * Math.sin(phi), Math.sin(theta) * Math.sin(phi), Math.cos(phi)];
    };
    const pos = new Float32Array(nodes.length * 3);
    const vel = new Float32Array(nodes.length * 3);
    const childrenOf = new Map();
    for (const [a, b] of links) {
      if (!childrenOf.has(a)) childrenOf.set(a, []);
      childrenOf.get(a).push(b);
    }
    (function seed(id, dir, radius, depth) {
      const kids = childrenOf.get(id) || [];
      kids.forEach((kid, i) => {
        const f = fib(i, Math.max(kids.length, 3));
        // The ฝ่าย leave the root in every direction — biasing them along the
        // parent's axis at depth 0 grew the whole graph out of one side and
        // left half the frame empty.
        const bias = depth === 0 ? 0 : 1.3;
        const d = [
          dir[0] * bias + f[0] * 0.9,
          dir[1] * bias + f[1] * 0.9,
          dir[2] * bias + f[2] * 0.9,
        ];
        const len = Math.hypot(d[0], d[1], d[2]) || 1;
        pos[kid * 3] = pos[id * 3] + (d[0] / len) * radius;
        pos[kid * 3 + 1] = pos[id * 3 + 1] + (d[1] / len) * radius;
        pos[kid * 3 + 2] = pos[id * 3 + 2] + (d[2] / len) * radius;
        seed(kid, [d[0] / len, d[1] / len, d[2] / len], radius * 0.62, depth + 1);
      });
    })(root.id, [0, 1, 0], 90, 0);

    // ---- forces ----
    // Repulsion uses a uniform-grid neighbour search: without a cutoff this is
    // 223,000 pairs per tick, which a phone will not do sixty times a second.
    const CUT = 26, CELL = CUT;
    const LEVEL_GAP = 58;
    const grid = new Map();
    const key = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
    let alpha = 1;
    let topDown = true;

    function tick() {
      alpha += (0 - alpha) * 0.021;

      grid.clear();
      for (let i = 0; i < nodes.length; i++) {
        const k = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        let bucket = grid.get(k);
        if (!bucket) { bucket = []; grid.set(k, bucket); }
        bucket.push(i);
      }

      // repulsion between neighbours only
      for (const [k, bucket] of grid) {
        const [gx, gy, gz] = k.split(',').map(Number);
        const near = [];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const b = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
          if (b) near.push(...b);
        }
        for (const i of bucket) {
          for (const j of near) {
            if (j <= i) continue;
            let dx = pos[j * 3] - pos[i * 3];
            let dy = pos[j * 3 + 1] - pos[i * 3 + 1];
            let dz = pos[j * 3 + 2] - pos[i * 3 + 2];
            let d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > CUT * CUT) continue;
            if (d2 < 0.01) { dx = Math.random() - .5; dy = Math.random() - .5; dz = Math.random() - .5; d2 = 0.01; }
            const d = Math.sqrt(d2);
            // cards need more personal space than the little structure dots,
            // and two different ฝ่าย need more space than two people in the
            // same one — that is what makes the clusters read as clusters
            const strength = ((nodes[i].kind === 'person' ? 150 : 110)
                           + (nodes[j].kind === 'person' ? 150 : 110))
                           * (nodes[i].di !== nodes[j].di ? 2.1 : 1);
            const f = (strength / d2) * alpha;
            const ux = dx / d, uy = dy / d, uz = dz / d;
            vel[i * 3] -= ux * f; vel[i * 3 + 1] -= uy * f; vel[i * 3 + 2] -= uz * f;
            vel[j * 3] += ux * f; vel[j * 3 + 1] += uy * f; vel[j * 3 + 2] += uz * f;
          }
        }
      }

      // link springs
      for (const [a, b, L] of links) {
        const dx = pos[b * 3] - pos[a * 3];
        const dy = pos[b * 3 + 1] - pos[a * 3 + 1];
        const dz = pos[b * 3 + 2] - pos[a * 3 + 2];
        const d = Math.hypot(dx, dy, dz) || 0.01;
        const f = ((d - L) / d) * 0.32 * alpha;
        vel[a * 3] += dx * f; vel[a * 3 + 1] += dy * f; vel[a * 3 + 2] += dz * f;
        vel[b * 3] -= dx * f; vel[b * 3 + 1] -= dy * f; vel[b * 3 + 2] -= dz * f;
      }

      // gentle pull to the middle so the graph cannot drift off screen
      for (let i = 0; i < nodes.length; i++) {
        vel[i * 3] -= pos[i * 3] * 0.0016 * alpha;
        vel[i * 3 + 1] -= pos[i * 3 + 1] * 0.0016 * alpha;
        vel[i * 3 + 2] -= pos[i * 3 + 2] * 0.0016 * alpha;
      }

      for (let i = 0; i < nodes.length * 3; i++) {
        vel[i] *= 0.55;
        pos[i] += vel[i];
      }

      // TOP-DOWN (the 3d-force-graph `dagMode: 'td'` idea): every node is held
      // on the Y plane of its own level, and the forces are left to sort out X
      // and Z. Without this the graph is a ball — pretty, but it stops reading
      // as a hierarchy, because "who reports to whom" has no direction in it.
      if (topDown) {
        for (let i = 0; i < nodes.length; i++) {
          const target = (maxLevel / 2 - nodes[i].level) * LEVEL_GAP;
          pos[i * 3 + 1] += (target - pos[i * 3 + 1]) * 0.9;
          vel[i * 3 + 1] *= 0.1;
        }
      }

      // ONE WEDGE PER ฝ่าย. Repulsion alone lets two ฝ่าย drift through each
      // other and interleave, and then no amount of colour separates them, so
      // each ฝ่าย owns an angular slice around the vertical axis.
      //
      // IT IS A SPRING, NOT A FENCE, and the first version got that wrong. A
      // hard clamp back into the slice left cards that were being squeezed only
      // one way out — further from the axis — so they ratcheted outward every
      // tick. Measured: a radius of 5,708 units, past the camera's far plane,
      // which renders as an empty canvas rather than as anything recognisable
      // as "too big". Pressure now relieves sideways instead, and a radius cap
      // stops any remaining drift from ever leaving the frame.
      const SLICE = (Math.PI * 2) / DATA.roots.length;
      const HALF = SLICE * 0.44;
      const R_MAX = 520;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.di < 0) continue;
        const x = pos[i * 3], z = pos[i * 3 + 2];
        const r = Math.hypot(x, z);
        if (r < 0.5) continue;
        const want = n.di * SLICE;
        let delta = Math.atan2(z, x) - want;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));      // wrap to ±π
        const over = Math.abs(delta) - HALF;
        if (over > 0) {
          // rotate part of the way back, and damp the tangential velocity
          const back = Math.sign(delta) * over * 0.35;
          const a = Math.atan2(z, x) - back;
          pos[i * 3] = Math.cos(a) * r;
          pos[i * 3 + 2] = Math.sin(a) * r;
          vel[i * 3] *= 0.7; vel[i * 3 + 2] *= 0.7;
        }
        if (r > R_MAX) {
          const k = R_MAX / r;
          pos[i * 3] *= k; pos[i * 3 + 2] *= k;
          vel[i * 3] *= 0.5; vel[i * 3 + 2] *= 0.5;
        }
      }

      // the root is the anchor
      pos[root.id * 3] = pos[root.id * 3 + 2] = 0;
      if (!topDown) pos[root.id * 3 + 1] = 0;
    }

    // ---- links ----
    const linePos = new Float32Array(links.length * 6);
    const lineCol = new Float32Array(links.length * 6);
    const lineColBase = new THREE.Color(css.getPropertyValue('--line-strong').trim() || '#ccc');
    links.forEach(([a, b], i) => {
      const c = new THREE.Color(tintHex(nodes[b].tint)).lerp(lineColBase, 0.5);
      lineCol.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
    scene.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.4,
    })));

    // ---- structure dots ----
    const sPos = new Float32Array(structs.length * 3);
    const sCol = new Float32Array(structs.length * 3);
    const sSize = new Float32Array(structs.length);
    structs.forEach((n, i) => {
      const c = new THREE.Color(tintHex(n.tint));
      sCol.set([c.r, c.g, c.b], i * 3);
      sSize[i] = n.kind === 'root' ? 26 : Math.max(7, n.r * 4);
    });
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
    sGeo.setAttribute('psize', new THREE.BufferAttribute(sSize, 1));
    const disc = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(.6, 'rgba(255,255,255,.96)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(32, 32, 30, 0, Math.PI * 2); x.fill();
      return new THREE.CanvasTexture(c);
    })();
    const dotMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: disc }, scale: { value: H() } },
      vertexShader: `
        attribute float psize; varying vec3 vColor; uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * (scale / 560.0) * (60.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          if (t.a < 0.2) discard;
          gl_FragColor = vec4(vColor, t.a);
        }`,
      vertexColors: true, transparent: true, depthWrite: false,
    });
    scene.add(new THREE.Points(sGeo, dotMat));

    // ---- person cards: one instanced quad, one atlas ----
    const atlas = new THREE.TextureLoader().load(window.CARD_ATLAS);
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.generateMipmaps = true;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;

    const cell = CARDS.cell;
    const CARD_H = 15, CARD_W = CARD_H * (cell.w / cell.h);
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]), 3));
    quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const iPos = new Float32Array(persons.length * 3);
    const iUv = new Float32Array(persons.length * 2);
    const iDim = new Float32Array(persons.length * 2);
    persons.forEach((p, i) => {
      const col = p.card % cell.cols, row = Math.floor(p.card / cell.cols);
      iUv[i * 2] = (col * cell.w) / cell.aw;
      iUv[i * 2 + 1] = 1 - ((row + 1) * cell.h) / cell.ah;
      iDim[i * 2] = cell.w / cell.aw;
      iDim[i * 2 + 1] = cell.h / cell.ah;
    });
    quad.setAttribute('aPos', new THREE.InstancedBufferAttribute(iPos, 3));
    quad.setAttribute('aUv', new THREE.InstancedBufferAttribute(iUv, 2));
    quad.setAttribute('aDim', new THREE.InstancedBufferAttribute(iDim, 2));
    quad.instanceCount = persons.length;

    const iFocus = new Float32Array(persons.length).fill(1);
    quad.setAttribute('aFocus', new THREE.InstancedBufferAttribute(iFocus, 1));
    const bg = new THREE.Color(css.getPropertyValue('--frame-bg').trim() || '#f2f3f0');

    const cardMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: atlas },
        right: { value: new THREE.Vector3(1, 0, 0) },
        up: { value: new THREE.Vector3(0, 1, 0) },
        size: { value: new THREE.Vector2(CARD_W, CARD_H) },
        bg: { value: bg },
      },
      vertexShader: `
        attribute vec3 aPos; attribute vec2 aUv; attribute vec2 aDim; attribute float aFocus;
        uniform vec3 right; uniform vec3 up; uniform vec2 size;
        varying vec2 vUv; varying vec2 vLocal; varying float vFocus;
        void main() {
          vUv = aUv + uv * aDim;
          vLocal = uv;
          vFocus = aFocus;
          // a card outside the focused ฝ่าย also shrinks, so the chosen group
          // gains size as well as contrast
          float s = mix(0.55, 1.0, aFocus);
          vec3 world = aPos + right * (position.x * size.x * s) + up * (position.y * size.y * s);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 bg;
        varying vec2 vUv; varying vec2 vLocal; varying float vFocus;
        void main() {
          // rounded corners, cut in the shader so the atlas can stay JPEG
          vec2 p = abs(vLocal - 0.5) * 2.0;
          vec2 q = max(p - vec2(0.86, 0.9), 0.0);
          if (length(q / vec2(0.14, 0.1)) > 1.0) discard;
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(mix(bg, t.rgb, mix(0.09, 1.0, vFocus)), 1.0);
        }`,
      transparent: false,
    });
    const cardMesh = new THREE.Mesh(quad, cardMat);
    cardMesh.frustumCulled = false;
    scene.add(cardMesh);

    // ---- ฝ่าย labels stay in the DOM ----
    const labels = nodes
      .filter((n) => n.kind === 'root' || (n.kind === 'role' && DATA.roots.some((r) => r.name === n.label)))
      .map((n) => {
        const el = document.createElement('span');
        el.className = 'c-label';
        el.textContent = n.label;
        stage.appendChild(el);
        return { el, n };
      });

    // ---- camera + input ----
    // Looking slightly DOWN at a top-down tree: the levels only read as levels
    // when the camera is above them.
    let yaw = 0.5, pitch = 0.22, dist = 330, auto = true, fitted = false;
    let drag = null, pinch = null, userZoomed = false;
    let zoomMin = 45, zoomMax = 2000;
    const center = new THREE.Vector3();
    const target = new THREE.Vector3();
    const onDown = (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; auto = false; };
    const onMove = (e) => {
      if (!drag) return;
      yaw += (e.clientX - drag.x) * 0.006;
      pitch = Math.max(-1.45, Math.min(1.45, pitch + (e.clientY - drag.y) * 0.006));
      drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      drag = { x: e.clientX, y: e.clientY, moved: drag.moved };
    };
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', () => { drag = null; });
    stage.addEventListener('pointercancel', () => { drag = null; });
    // ZOOM IS THE USER'S, AND IT STICKS. The first version refit the camera on
    // every resize — and a pinch on a phone resizes the visual viewport, so the
    // gesture fought an auto-fit that kept yanking the camera back to its
    // computed framing. That is the "it shows another view then switches back"
    // flicker. Once the view has been zoomed by hand, only an explicit action
    // (fullscreen, changing layout) is allowed to reframe it.
    const zoomBy = (factor) => {
      dist = Math.max(zoomMin, Math.min(zoomMax, dist * factor));
      userZoomed = true;
      auto = false;
    };
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomBy(1 + e.deltaY * 0.0012);
    }, { passive: false });
    stage.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      if (pinch) zoomBy(pinch / d);
      pinch = d;
    }, { passive: false });
    stage.addEventListener('touchend', () => { pinch = null; });

    // ---- pick a card: project every person and take the nearest hit ----
    const card = document.getElementById('cCard');
    const proj = new THREE.Vector3();
    stage.addEventListener('click', (e) => {
      if (drag && drag.moved > 6) return;
      const r = stage.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bestD = 1e9;
      persons.forEach((p, i) => {
        proj.set(pos[p.id * 3], pos[p.id * 3 + 1], pos[p.id * 3 + 2]).project(camera);
        if (proj.z > 1) return;
        const sx = (proj.x * 0.5 + 0.5) * r.width;
        const sy = (-proj.y * 0.5 + 0.5) * r.height;
        const d = Math.hypot(sx - mx, sy - my);
        if (d < bestD) { bestD = d; best = p; }
      });
      if (!best || bestD > 26) { card.hidden = true; return; }
      card.hidden = false;
      card.innerHTML = `<b>${esc(best.label)}${best.nick ? ' (' + esc(best.nick) + ')' : ''}</b>
        <span class="c-people">${esc(best.role)}</span>
        <span class="c-people" style="opacity:.7">${esc(best.dept)}${best.path ? ' › ' + esc(best.path) : ''}</span>`;
    });

    // ---- focus one ฝ่าย ----
    // Colour alone stops separating eleven groups once they overlap on screen,
    // so this removes the other ten instead: everything else fades into the
    // background and the camera reframes on the one that is left.
    let focus = -1;
    const baseLineCol = lineCol.slice();
    const baseDotCol = sCol.slice();
    const fade = (arr, base, on, i, stride) => {
      for (let k = 0; k < stride; k += 3) {
        const c = new THREE.Color(base[i * stride + k], base[i * stride + k + 1], base[i * stride + k + 2]);
        if (!on) c.lerp(bg, 0.9);
        arr[i * stride + k] = c.r;
        arr[i * stride + k + 1] = c.g;
        arr[i * stride + k + 2] = c.b;
      }
    };
    function applyFocus(di) {
      focus = di;
      persons.forEach((p, i) => { iFocus[i] = (di < 0 || p.di === di) ? 1 : 0; });
      quad.attributes.aFocus.needsUpdate = true;
      links.forEach(([, b], i) => fade(lineCol, baseLineCol, di < 0 || nodes[b].di === di, i, 6));
      lineGeo.attributes.color.needsUpdate = true;
      structs.forEach((n, i) => fade(sCol, baseDotCol, di < 0 || n.di === di || n.kind === 'root', i, 3));
      sGeo.attributes.color.needsUpdate = true;
      for (const { el, n } of labels) {
        el.classList.toggle('is-muted', di >= 0 && n.di !== di && n.kind !== 'root');
      }
      [...legend.children].forEach((b, i) => {
        b.setAttribute('aria-pressed', String(i === 0 ? di < 0 : i - 1 === di));
      });
      fitted = false;       // reframe on whatever is now visible
      userZoomed = false;
    }

    const legend = document.getElementById('cLegend');
    legend.hidden = false;
    legend.innerHTML = `<button type="button" data-di="-1" aria-pressed="true">ทุกฝ่าย</button>`
      + DATA.roots.map((r, i) => `
        <button type="button" data-di="${i}" style="--tint: var(--dept-${r.tint})"
                aria-pressed="false">${esc(r.name)}</button>`).join('');
    legend.addEventListener('click', (e) => {
      const b = e.target.closest('[data-di]');
      if (!b) return;
      const di = Number(b.dataset.di);
      applyFocus(di === focus ? -1 : di);
    });

    // ---- controls: layout + fullscreen ----
    const btns = document.getElementById('cBtns');
    btns.hidden = false;

    const dagBtn = document.getElementById('cDag');
    dagBtn.addEventListener('click', () => {
      topDown = !topDown;
      userZoomed = false;
      dagBtn.setAttribute('aria-pressed', String(topDown));
      dagBtn.textContent = topDown ? 'บนลงล่าง' : 'กระจายรอบทิศ';
      // re-run the simulation so the new constraint actually re-settles
      alpha = 0.7;
      settled = Math.min(settled, SETTLE - 90);
      fitted = false;
    });

    const fullBtn = document.getElementById('cFull');
    const setExpanded = (on) => {
      stage.classList.toggle('is-expanded', on);
      document.body.classList.toggle('is-locked', on);
      fullBtn.textContent = on ? 'ออกจากเต็มจอ' : 'เต็มจอ';
      userZoomed = false;
      fitted = false;
    };
    fullBtn.addEventListener('click', async () => {
      const real = document.fullscreenElement === stage;
      const expanded = stage.classList.contains('is-expanded');
      if (real) { document.exitFullscreen?.(); return; }
      if (expanded) { setExpanded(false); return; }
      try {
        if (stage.requestFullscreen && document.fullscreenEnabled) {
          await stage.requestFullscreen();
          fullBtn.textContent = 'ออกจากเต็มจอ';
          fitted = false;
          return;
        }
      } catch { /* the host frame refused — fall through to the overlay */ }
      setExpanded(true);
    });
    document.addEventListener('fullscreenchange', () => {
      const real = document.fullscreenElement === stage;
      fullBtn.textContent = real ? 'ออกจากเต็มจอ' : 'เต็มจอ';
      fitted = false;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && stage.classList.contains('is-expanded')) setExpanded(false);
    });

    // ---- loop ----
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const placed = [];
    const status = document.getElementById('cStatus');
    let settled = 0;
    const SETTLE = 260;
    let raf = 0;

    function frame() {
      // Physics runs a few ticks per painted frame so the graph is watched
      // finding its shape, the way the reference demo does — and so a phone is
      // never blocked by one long synchronous solve.
      if (settled < SETTLE) {
        const budget = settled < 40 ? 3 : 2;
        for (let i = 0; i < budget && settled < SETTLE; i++, settled++) tick();
        if (status) {
          status.textContent = settled >= SETTLE ? '' : `กำลังจัดผัง ${Math.round(settled / SETTLE * 100)}%`;
          status.hidden = settled >= SETTLE;
        }
      }

      if (auto && !reduce) yaw += 0.0011;

      // Orbit the graph's own centre, and frame it by its real radius. The
      // first version orbited the origin at a fixed distance, so the whole
      // organisation sat in the top half of the screen with dead space below —
      // the root is an anchor, not the middle of the mass.
      // Centre on what is actually being looked at: the whole graph, or just
      // the focused ฝ่าย.
      const inView = (n) => focus < 0 || n.di === focus;
      target.set(0, 0, 0);
      let seen = 0;
      for (const n of nodes) {
        if (!inView(n)) continue;
        target.x += pos[n.id * 3]; target.y += pos[n.id * 3 + 1]; target.z += pos[n.id * 3 + 2];
        seen++;
      }
      if (seen) target.multiplyScalar(1 / seen);
      // ease so a focus change glides instead of cutting
      center.lerp(target, settled < SETTLE ? 1 : 0.08);
      if (settled >= SETTLE && !fitted) {
        // Fit the two axes separately. A single bounding-sphere fit is wrong
        // for a top-down tree: it is much taller than it is wide, so the sphere
        // is mostly empty and the graph ends up tiny in the middle of the frame.
        // The horizontal extent is measured as a radius in X/Z so the fit still
        // holds while the graph spins.
        let halfY = 0, halfXZ = 0;
        for (const n of nodes) {
          if (!inView(n)) continue;
          halfY = Math.max(halfY, Math.abs(pos[n.id * 3 + 1] - target.y));
          halfXZ = Math.max(halfXZ, Math.hypot(pos[n.id * 3] - target.x, pos[n.id * 3 + 2] - target.z));
        }
        const t = Math.tan((camera.fov * Math.PI / 180) / 2);
        const fit = Math.max(
          (halfY + CARD_H) / t,
          (halfXZ + CARD_W) / (t * camera.aspect),
        ) * 1.06;
        // The zoom range is derived from the graph itself: close enough to read
        // one card, far enough to see the whole thing with air around it.
        zoomMin = Math.max(30, CARD_H * 2.2);
        zoomMax = fit * 2.4;
        dist = fit;
        fitted = true;
      }

      camera.position.set(
        center.x + dist * Math.cos(pitch) * Math.sin(yaw),
        center.y + dist * Math.sin(pitch),
        center.z + dist * Math.cos(pitch) * Math.cos(yaw),
      );
      camera.lookAt(center);

      // billboard basis for the cards
      cardMat.uniforms.right.value.setFromMatrixColumn(camera.matrixWorld, 0);
      cardMat.uniforms.up.value.setFromMatrixColumn(camera.matrixWorld, 1);

      // push positions into the buffers
      links.forEach(([a, b], i) => {
        linePos.set([pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2],
          pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], i * 6);
      });
      lineGeo.attributes.position.needsUpdate = true;
      structs.forEach((n, i) => {
        sPos.set([pos[n.id * 3], pos[n.id * 3 + 1], pos[n.id * 3 + 2]], i * 3);
      });
      sGeo.attributes.position.needsUpdate = true;
      persons.forEach((p, i) => {
        iPos.set([pos[p.id * 3], pos[p.id * 3 + 1], pos[p.id * 3 + 2]], i * 3);
      });
      quad.attributes.aPos.needsUpdate = true;

      renderer.render(scene, camera);

      // Labels are drawn nearest-first and a later one is dropped if it would
      // land on top of one already placed. Eleven ฝ่าย names stacked on the
      // same few pixels is not a label layer, it is a smudge.
      placed.length = 0;
      const order = labels
        .map((l) => {
          proj.set(pos[l.n.id * 3], pos[l.n.id * 3 + 1], pos[l.n.id * 3 + 2]).project(camera);
          return { l, x: (proj.x * 0.5 + 0.5) * W(), y: (-proj.y * 0.5 + 0.5) * H(), z: proj.z };
        })
        .sort((a, b) => a.z - b.z);
      for (const { l, x, y, z } of order) {
        // Sits above its node, not on it: in top-down mode every ฝ่าย shares one
        // Y plane, so a label centred on the node lands on the ฝ่าย's own cards.
        const ly = y - 16;
        const clash = z > 1 || placed.some((p) => Math.abs(p.x - x) < 82 && Math.abs(p.y - ly) < 17);
        l.el.style.display = clash ? 'none' : '';
        if (clash) continue;
        placed.push({ x, y: ly });
        l.el.style.left = `${x}px`;
        l.el.style.top = `${ly}px`;
        l.el.style.opacity = String(Math.max(0.45, 1 - Math.max(0, z) * 0.75));
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // A WebGL canvas left spinning in a scrolled-past section is pure battery
    // drain, so stop the loop whenever the frame is off screen.
    new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting && !raf) raf = requestAnimationFrame(frame);
        else if (!en.isIntersecting && raf) { cancelAnimationFrame(raf); raf = 0; }
      }
    }, { threshold: 0.05 }).observe(stage);

    new ResizeObserver(() => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W(), H());
      dotMat.uniforms.scale.value = H();
      // Refit ONLY if the view is still the one we chose. See zoomBy().
      if (!userZoomed) fitted = false;
    }).observe(stage);
  }

  boot.addEventListener('click', start3d);
  new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting && e.intersectionRatio > 0.5)) {
      obs.disconnect();
      start3d();
    }
  }, { threshold: [0.5] }).observe(stage);
})();
