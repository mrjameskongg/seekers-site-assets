/*!
 * liquid-logo.js — renders a logo as slow-moving liquid copper.
 *
 * Put data-liquid-logo on an inline <svg> (or a same-origin <img>) and load
 * this file. No dependencies, WebGL 1, ~7 KB gzipped.
 *
 *   <svg data-liquid-logo role="img" aria-label="Chanty" ...>...</svg>
 *   <script src="liquid-logo.js" defer></script>
 *
 * The original logo is never removed: it stays in place for layout, links and
 * screen readers, and a canvas is laid over it. If WebGL is unavailable or the
 * context is lost, the canvas goes away and the logo is shown as before.
 * Under prefers-reduced-motion a single still frame is rendered.
 *
 * Options, as attributes on the logo:
 *   data-liquid-speed="1"        flow speed multiplier
 *   data-liquid-palette="..."    comma-separated hex stops, dark to light
 *
 * JS: LiquidLogo.mount(el, { speed, palette }) returns { destroy } or null.
 */
(function () {
  'use strict';

  // The Chanty wordmark gradient (#fab077 -> #cd713b), stretched a little
  // darker and lighter so the metal has somewhere to go. The dark end stays
  // well above the burgundy page colour so the letters never disappear.
  var COPPER = ['#8a3a1d', '#b35a2c', '#cd713b', '#e28b52', '#fab077', '#fdd2a6', '#fff3e4'];

  var VERT =
    'attribute vec2 a_pos;' +
    'varying vec2 v_uv;' +
    'void main(){v_uv=a_pos*0.5+0.5;gl_Position=vec4(a_pos,0.0,1.0);}';

  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 v_uv;',
    'uniform sampler2D u_mask;', // r: coverage, g/b: height
    'uniform sampler2D u_pal;',
    'uniform vec2 u_texel;',
    'uniform float u_aspect;',
    'uniform float u_bevel;',
    'uniform float u_time;',
    'uniform vec2 u_light;',

    'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float noise(vec2 p){',
    '  vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float s=0.0,a=0.5;',
    '  for(int i=0;i<4;i++){s+=a*noise(p);p=p*2.02+vec2(3.1,1.7);a*=0.5;}',
    '  return s;',
    '}',
    // Half sine, half triangle: soft bands with a crisp crest, like a
    // reflected horizon on polished metal.
    'float height(vec2 uv){vec4 m=texture2D(u_mask,uv);return m.g+m.b/256.0;}',
    'vec3 metal(float b){',
    '  float tri=abs(fract(b)*2.0-1.0);',
    '  float sn=0.5+0.5*cos(b*6.28318);',
    '  return texture2D(u_pal,vec2(mix(sn,tri,0.5),0.5)).rgb;',
    '}',

    'void main(){',
    '  vec2 uv=vec2(v_uv.x,1.0-v_uv.y);',
    '  vec4 m=texture2D(u_mask,uv);',
    '  float a=m.r;',
    '  if(a<0.004){gl_FragColor=vec4(0.0);return;}',

    // Surface normal from the height field.
    '  float h=m.g+m.b/256.0;',
    '  float hx=height(uv+vec2(u_texel.x,0.0))-height(uv-vec2(u_texel.x,0.0));',
    '  float hy=height(uv+vec2(0.0,u_texel.y))-height(uv-vec2(0.0,u_texel.y));',
    // Thin strokes never get tall, so flatten them rather than let them sink
    // into shadow (keeps small script, like the Khmer mark, legible).
    '  float relief=mix(0.35,1.0,smoothstep(0.15,0.6,h));',
    '  vec3 n=normalize(vec3(vec2(-hx,hy)*u_bevel*relief,1.0));',
    '  vec3 r=reflect(vec3(0.0,0.0,-1.0),n);',

    // Slow domain-warped flow; the bevel reflection bends the bands around
    // each stroke so the letters read as rounded, poured metal.
    '  float t=u_time;',
    '  vec2 p=vec2(uv.x*u_aspect,uv.y);',
    '  vec2 w=vec2(fbm(p*0.9+vec2(0.0,t*0.05)),fbm(p*0.9+vec2(4.3,1.9)-vec2(t*0.04,0.0)));',
    '  float band=0.35*p.x-0.6*uv.y+0.55*r.y+0.25*r.x+2.2*(w.x-0.5)+1.2*(w.y-0.5)+t*0.03;',

    // A touch of dispersion on the curved edges only.
    '  float d=0.02*(1.0-n.z)+0.003;',
    '  vec3 col=vec3(metal(band+d).r,metal(band).g,metal(band-d).b);',

    '  col*=0.86+0.14*smoothstep(0.05,0.5,h);',
    '  vec3 L=normalize(vec3(u_light+vec2(-0.45,0.6),1.0));',
    '  float spec=pow(max(dot(r,L),0.0),28.0);',
    '  col+=spec*0.45*texture2D(u_pal,vec2(1.0,0.5)).rgb;',
    '  col+=(hash(gl_FragCoord.xy+fract(t))-0.5)*(2.0/255.0);',
    '  gl_FragColor=vec4(clamp(col,0.0,1.0)*a,a);',
    '}'
  ].join('\n');

  var INF = 1e20;

  // 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
  function edt1d(f, d, v, z, n) {
    var k = 0, q, s;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (q = 1; q < n; q++) {
      do {
        s = (f[q] - f[v[k]] + q * q - v[k] * v[k]) / (q - v[k]) / 2;
      } while (s <= z[k] && --k > -1);
      k++;
      v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    for (k = 0, q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      s = q - v[k];
      d[q] = s * s + f[v[k]];
    }
  }

  // Distance (px) from each inside pixel to the nearest outside pixel.
  function insideDistance(inside, w, h) {
    var size = Math.max(w, h);
    var grid = new Float64Array(w * h);
    var f = new Float64Array(size), d = new Float64Array(size);
    var v = new Int32Array(size), z = new Float64Array(size + 1);
    var x, y, i;
    for (i = 0; i < w * h; i++) grid[i] = inside[i] ? INF : 0;
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) f[y] = grid[y * w + x];
      edt1d(f, d, v, z, h);
      for (y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) f[x] = grid[y * w + x];
      edt1d(f, d, v, z, w);
      for (x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x]);
    }
    return grid;
  }

  // Box blur of radius r along one axis (running sum), src -> dst.
  function blurPass(src, dst, w, h, r, horizontal) {
    var len = horizontal ? w : h, lines = horizontal ? h : w;
    var step = horizontal ? 1 : w, norm = 1 / (2 * r + 1), line, j, base, sum;
    for (line = 0; line < lines; line++) {
      base = horizontal ? line * w : line;
      sum = 0;
      for (j = -r; j <= r; j++) sum += src[base + Math.min(len - 1, Math.max(0, j)) * step];
      for (j = 0; j < len; j++) {
        dst[base + j * step] = sum * norm;
        sum += src[base + Math.min(len - 1, j + r + 1) * step] - src[base + Math.max(0, j - r) * step];
      }
    }
  }

  // Three box passes each way approximate a gaussian.
  function blur(src, w, h, r) {
    var a = src, b = new Float32Array(w * h), k;
    for (k = 0; k < 3; k++) {
      blurPass(a, b, w, h, r, true);
      blurPass(b, a, w, h, r, false);
    }
    return a;
  }

  // RGBA texture: R = logo coverage, G/B = height (16 bit, high/low byte).
  // The height is the logo blurred by about half its stroke width, which
  // gives every stroke a soft, pillowed profile with no ridge line.
  function makeMask(image, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    var px = ctx.getImageData(0, 0, w, h).data; // throws if the image taints the canvas
    var n = w * h, inside = new Uint8Array(n), cover = new Float32Array(n), i;
    for (i = 0; i < n; i++) {
      cover[i] = px[i * 4 + 3] / 255;
      inside[i] = cover[i] >= 0.5 ? 1 : 0;
    }

    var dist = insideDistance(inside, w, h), maxD = 0;
    for (i = 0; i < n; i++) if (inside[i] && dist[i] < 1e9 && dist[i] > maxD) maxD = dist[i];
    var bevel = Math.max(1, Math.round(maxD * 0.6));

    var height = blur(cover, w, h, bevel), top = 0;
    for (i = 0; i < n; i++) if (inside[i] && height[i] > top) top = height[i];
    top = top || 1;

    var out = new Uint8Array(n * 4), v;
    for (i = 0; i < n; i++) {
      v = Math.round(Math.min(1, height[i] / top) * 65535);
      out[i * 4] = px[i * 4 + 3];
      out[i * 4 + 1] = v >> 8;
      out[i * 4 + 2] = v & 255;
      out[i * 4 + 3] = 255;
    }
    return { data: out, bevel: bevel };
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  // Draws the logo at exactly w x h device pixels.
  function rasterize(el, w, h) {
    if (el instanceof HTMLImageElement) {
      return el.complete && el.naturalWidth
        ? Promise.resolve(el)
        : new Promise(function (resolve, reject) {
            el.addEventListener('load', function () { resolve(el); }, { once: true });
            el.addEventListener('error', reject, { once: true });
          });
    }
    var clone = el.cloneNode(true);
    clone.removeAttribute('style');
    clone.removeAttribute('class');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    var url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
    );
    return loadImage(url).then(
      function (img) { URL.revokeObjectURL(url); return img; },
      function (err) { URL.revokeObjectURL(url); throw err; }
    );
  }

  function paletteCanvas(stops) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 1;
    var ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 256, 0);
    stops.forEach(function (s, i) { g.addColorStop(i / (stops.length - 1), s); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 1);
    return c;
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function texture(gl, unit) {
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function mount(el, opts) {
    opts = opts || {};
    if (el.__liquidLogo) return el.__liquidLogo;

    var speed = parseFloat(opts.speed != null ? opts.speed : el.getAttribute('data-liquid-speed'));
    if (!(speed >= 0)) speed = 1;
    var paletteAttr = el.getAttribute('data-liquid-palette');
    var palette = opts.palette || (paletteAttr ? paletteAttr.split(',').map(function (s) { return s.trim(); }) : COPPER);
    var reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    var canvas = document.createElement('canvas');
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return null;

    var prog, u = {};
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      return null;
    }
    gl.useProgram(prog);
    ['u_mask', 'u_pal', 'u_texel', 'u_aspect', 'u_bevel', 'u_time', 'u_light'].forEach(function (name) {
      u[name] = gl.getUniformLocation(prog, name);
    });

    // One oversized triangle covers the viewport.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    texture(gl, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paletteCanvas(palette));
    var maskTex = texture(gl, 0);
    gl.uniform1i(u.u_mask, 0);
    gl.uniform1i(u.u_pal, 1);

    // The canvas sits on top of the logo without touching the page layout.
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText =
      'position:absolute;left:0;top:0;pointer-events:none;opacity:0;transition:opacity .9s ease;';
    el.parentNode.insertBefore(canvas, el.nextSibling);

    var savedOpacity = el.style.opacity, savedTransition = el.style.transition;
    var cssW = 0, cssH = 0, dpr = 0, offX = 0, offY = 0;
    var time = reduceMotion ? 14 : Math.random() * 40;
    var lightX = 0, lightY = 0, targetX = 0, targetY = 0;
    var visible = true, raf = 0, last = 0, building = false, ready = false, dead = false;

    function align() {
      var er = el.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      var dx = er.left - cr.left, dy = er.top - cr.top;
      if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25) {
        offX += dx; offY += dy;
        canvas.style.left = offX + 'px';
        canvas.style.top = offY + 'px';
      }
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (!building && (Math.abs(er.width - cssW) > 0.5 || Math.abs(er.height - cssH) > 0.5 || ratio !== dpr)) {
        build();
      }
    }

    function build() {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      building = true;
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.round(r.width * ratio), h = Math.round(r.height * ratio);
      rasterize(el, w, h).then(function (img) {
        if (dead) return;
        var mask = makeMask(img, w, h);
        cssW = r.width; cssH = r.height; dpr = ratio;
        canvas.width = w; canvas.height = h;
        canvas.style.width = r.width + 'px';
        canvas.style.height = r.height + 'px';
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, mask.data);
        gl.uniform2f(u.u_texel, 1 / w, 1 / h);
        gl.uniform1f(u.u_aspect, w / h);
        gl.uniform1f(u.u_bevel, mask.bevel);
        building = false;
        align();
        draw();
        if (!ready) {
          ready = true;
          el.style.transition = 'opacity .9s ease';
          el.style.opacity = '0';
          canvas.style.opacity = '1';
        }
        schedule();
      }).catch(function () {
        destroy(); // tainted <img>, broken SVG, ... leave the logo as it was
      });
    }

    function draw() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(u.u_time, time);
      gl.uniform2f(u.u_light, lightX, lightY);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      raf = 0;
      if (!running()) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      time += dt * speed;
      // Idle drift keeps the highlight moving on touch screens; the pointer
      // leans on it when there is one.
      var idleX = Math.sin(time * 0.23) * 0.35, idleY = Math.cos(time * 0.17) * 0.25;
      lightX += (idleX + targetX - lightX) * 0.05;
      lightY += (idleY + targetY - lightY) * 0.05;
      align();
      draw();
      raf = requestAnimationFrame(frame);
    }

    function running() {
      return ready && !dead && !reduceMotion && visible && !document.hidden;
    }

    function schedule() {
      if (running() && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    }

    function onPointer(e) {
      var r = el.getBoundingClientRect(), span = Math.max(r.width, r.height, 1) * 1.5;
      targetX = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / span));
      targetY = Math.max(-1, Math.min(1, ((r.top + r.height / 2) - e.clientY) / span));
    }

    function onResize() {
      if (!running() && ready) { align(); if (!building) draw(); }
    }

    function onLost(e) {
      e.preventDefault();
      destroy();
    }

    var io = 'IntersectionObserver' in window
      ? new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; schedule(); })
      : null;
    var ro = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null;
    if (io) io.observe(el);
    if (ro) ro.observe(el);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', schedule);
    if (!reduceMotion) window.addEventListener('pointermove', onPointer, { passive: true });
    canvas.addEventListener('webglcontextlost', onLost);

    function destroy() {
      if (dead) return;
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      if (io) io.disconnect();
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('webglcontextlost', onLost);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      el.style.opacity = savedOpacity;
      el.style.transition = savedTransition;
      delete el.__liquidLogo;
    }

    var handle = { destroy: destroy };
    el.__liquidLogo = handle;

    // Wait for web fonts so an SVG with <text> rasterizes in its real face.
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () {
      if (!dead) build();
    });
    return handle;
  }

  function init() {
    var nodes = document.querySelectorAll('[data-liquid-logo]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  window.LiquidLogo = { mount: mount, init: init };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
