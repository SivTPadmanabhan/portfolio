// Sivaditya Padmanabhan - portfolio interactions
// One continuous animation on the page: the hero ring shader (D25).
// Everything else fires once after load or on hover/click only (D26).

(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Listeners that ride the hero shader's clock (the glass rims sample
  // the same math the shader draws, so edges react to the moving light).
  // Called with the current shader time from inside the one rAF loop.
  var frameHooks = [];
  var heroShaderActive = false; // true once the hero shader is drawing

  /* ================================================================
     Shared WebGL scaffolding: fullscreen-triangle shader on a canvas.
     Returns { draw(time), resize } or null when WebGL is unavailable.
     ================================================================ */
  function mountShader(canvas, fragmentSrc) {
    var gl = canvas.getContext('webgl', { antialias: true }) ||
             canvas.getContext('experimental-webgl');
    if (!gl) return null;

    var vertexSrc =
      'attribute vec2 position;' +
      'void main() { gl_Position = vec4(position, 0.0, 1.0); }';

    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
      return sh;
    }

    var vs = compile(gl.VERTEX_SHADER, vertexSrc);
    var fs = compile(gl.FRAGMENT_SHADER, fragmentSrc);
    if (!vs || !fs) return null;

    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    var resLoc = gl.getUniformLocation(program, 'resolution');
    var timeLoc = gl.getUniformLocation(program, 'time');

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resLoc, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    return {
      draw: function (time) {
        gl.uniform1f(timeLoc, time);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      resize: resize
    };
  }

  /* ================================================================
     Hero shader: the supplied ShaderAnimation component, ported 1:1
     to raw WebGL. Fragment math is byte-for-byte the original -
     ring intensities map straight to RGB, no brand remap (D25).
     ================================================================ */
  (function initHeroShader() {
    var canvas = document.querySelector('.hero-shader');
    if (!canvas) return;

    var fragmentSrc =
      '#define TWO_PI 6.2831853072\n' +
      '#define PI 3.14159265359\n' +
      'precision highp float;\n' +
      'uniform vec2 resolution;\n' +
      'uniform float time;\n' +
      'void main(void) {\n' +
      '  vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);\n' +
      '  float t = time*0.05;\n' +
      '  float lineWidth = 0.002;\n' +
      '  vec3 color = vec3(0.0);\n' +
      '  for(int j = 0; j < 3; j++){\n' +
      '    for(int i=0; i < 5; i++){\n' +
      '      color[j] += lineWidth*float(i*i) / abs(fract(t - 0.01*float(j)+float(i)*0.01)*5.0 - length(uv) + mod(uv.x+uv.y, 0.2));\n' +
      '    }\n' +
      '  }\n' +
      // dim near the center so the name reads without a backdrop: rings
      // start faint, gain intensity fast, and level off past the ellipse
      '  float att = 0.12 + 0.88 * smoothstep(0.18, 0.62, length(uv * vec2(0.62, 1.0)));\n' +
      '  color *= att;\n' +
      '  gl_FragColor = vec4(color[0],color[1],color[2],1.0);\n' +
      '}';

    var shader = mountShader(canvas, fragmentSrc);
    if (!shader) return; // no WebGL: hero simply stays black

    var shaderTime = 1.0; // uniform starts at 1.0 in the original
    heroShaderActive = true;

    if (reducedMotion) {
      shader.draw(40.0); // a pleasing static frame; the glass rims
      return;            // sample this same frozen time once (D34)
    }

    var visible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
      }, { threshold: 0 }).observe(canvas);
    }

    (function loop() {
      if (visible) {
        shaderTime += 0.05; // original increment
        shader.draw(shaderTime);
        for (var i = 0; i < frameHooks.length; i++) frameHooks[i](shaderTime);
      }
      requestAnimationFrame(loop);
    })();
  })();

  /* ================================================================
     Liquid glass, Apple Tahoe port (D32). Three ported pieces from the
     supplied React component:
       1. A convex lens displacement map per glass element, merged into
          the #hero-lens SVG filter that refracts the hero shader.
       2. A directional inset bevel (box-shadow stack) lit from a fixed
          scene light at the hero's top center.
       3. A hairline conic-gradient rim whose bright spots come from
          analyzing the lens map against the light direction.
     Everything is computed once after load (and on resize): the only
     per-frame work is the browser re-applying the static filter as the
     shader canvas redraws, so the motion diet (D26) holds.
     ================================================================ */
  (function initTahoeGlass() {
    var glasses = Array.prototype.slice.call(document.querySelectorAll('.glass'));
    if (!glasses.length) return;

    var hero = document.querySelector('.hero');
    var heroCanvas = document.querySelector('.hero-shader');
    var lensFilter = document.getElementById('hero-lens');
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var XLINK_NS = 'http://www.w3.org/1999/xlink';
    var BINS = 24;
    var LIGHT = { x: 0.5, y: 0.0 }; // fixed scene light: hero top-center

    // Convex superellipse displacement map, RG-encoded normals pulling
    // toward the center (magnification), neutral gray outside the lens.
    function generateConvexMap(width, height) {
      var w = Math.max(1, Math.round(width) || 0);
      var h = Math.max(1, Math.round(height) || 0);
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (!ctx) return null;

      var imgData = ctx.createImageData(w, h);
      var data = imgData.data;
      var power = 3.5;

      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var nx = (x / w) * 2 - 1;
          var ny = (y / h) * 2 - 1;
          var d = Math.pow(Math.abs(nx), power) + Math.pow(Math.abs(ny), power);
          var r = 128, g = 128;
          if (d <= 1) {
            var curve = Math.sin(Math.pow(d, 0.8) * Math.PI);
            r = Math.round(128 + (-nx * curve) * 127);
            g = Math.round(128 + (-ny * curve) * 127);
          }
          var i = (y * w + x) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = 128;
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      return { url: canvas.toDataURL('image/png'), width: w, height: h, data: data };
    }

    // How the lens edges catch the scene light: a 24-bin brightness
    // profile around the rim plus the dominant refraction direction.
    function analyzeRefraction(map, lightAz) {
      var width = map.width, height = map.height, data = map.data;
      var profile = new Array(BINS);
      var counts = new Array(BINS);
      for (var b = 0; b < BINS; b++) { profile[b] = 0; counts[b] = 0; }
      var sumX = 0, sumY = 0, sumMag = 0;

      var step = 2;
      for (var y = 0; y < height; y += step) {
        for (var x = 0; x < width; x += step) {
          var i = (y * width + x) * 4;
          var bx = (data[i] - 128) / 127;
          var by = (data[i + 1] - 128) / 127;
          var mag = Math.sqrt(bx * bx + by * by);
          if (mag < 0.02) continue;

          var ang = Math.atan2(by, bx);
          var facing = Math.max(0, Math.cos(ang - lightAz));
          var bright = mag * (0.35 + 0.65 * facing);

          sumX += Math.cos(ang) * bright;
          sumY += Math.sin(ang) * bright;
          sumMag += bright;

          var bin = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
          if (bin < 0) bin += BINS;
          profile[bin] += bright;
          counts[bin]++;
        }
      }

      var maxP = 0;
      for (b = 0; b < BINS; b++) {
        if (counts[b]) profile[b] /= counts[b];
        if (profile[b] > maxP) maxP = profile[b];
      }
      if (maxP > 0) {
        for (b = 0; b < BINS; b++) profile[b] /= maxP;
      }

      var samples = Math.max(1, (width * height) / (step * step));
      return {
        profile: profile,
        domAngle: Math.atan2(sumY, sumX),
        magnitude: Math.min(1, (sumMag / samples) * 6)
      };
    }

    // The component's ten-layer bevel with color-mix() resolved to rgba.
    // White highlights run at 45% of the component's alphas: the edges
    // should read thin and dark, not as bright bands (D34).
    function bevelShadow(cos, sin, rim) {
      function px(v) { return v.toFixed(2) + 'px'; }
      function white(a) { return 'rgba(255,255,255,' + (a * 0.45).toFixed(3) + ')'; }
      function black(a) { return 'rgba(0,0,0,' + a.toFixed(2) + ')'; }
      return [
        'inset 0 0 0 1px ' + white(rim * 0.20),
        'inset ' + px(cos * 1.8) + ' ' + px(sin * 3) + ' 0 -2px ' + white(rim * 0.90),
        'inset ' + px(cos * -2) + ' ' + px(sin * -2) + ' 0 -2px ' + white(rim * 0.80),
        'inset ' + px(cos * -3) + ' ' + px(sin * -8) + ' 1px -6px ' + white(rim * 0.60),
        'inset ' + px(cos * -0.3) + ' ' + px(sin * -1) + ' 4px 0 ' + black(0.12),
        'inset ' + px(cos * -1.5) + ' ' + px(sin * 2.5) + ' 0 -2px ' + black(0.20),
        'inset 0 ' + px(sin * 3) + ' 4px -2px ' + black(0.20),
        'inset ' + px(cos * 2) + ' ' + px(sin * -6.5) + ' 1px -4px ' + black(0.10),
        px(cos * 4) + ' ' + px(sin * 4) + ' 10px 0 ' + black(0.15),
        px(cos * 9) + ' ' + px(sin * 9) + ' 18px 0 ' + black(0.10)
      ].join(', ');
    }

    // Transform-independent position (entrance animations translate
    // elements, offsets give the settled layout)
    function offsetWithin(el, ancestor) {
      var x = 0, y = 0, node = el;
      while (node && node !== ancestor) {
        x += node.offsetLeft;
        y += node.offsetTop;
        node = node.offsetParent;
      }
      return { x: x, y: y };
    }

    /* ---- Reactive rim (D34): re-evaluate the hero shader's fragment
       math in JS at points around each glass edge, so the rim stays
       near-black and only lights up where a ring actually passes. ---- */
    var RIM_BINS = 16;
    var rimTargets = []; // hero glass elements: {el, cx, cy, rx, ry}

    // Port of the hero fragment for one point (hero-local CSS px).
    // gl_FragCoord runs bottom-up, hence the y flip.
    function sampleShader(x, y, heroW, heroH, time) {
      var m = Math.min(heroW, heroH);
      var gy = heroH - y;
      var ux = (x * 2 - heroW) / m;
      var uy = (gy * 2 - heroH) / m;
      var t = time * 0.05;
      var len = Math.sqrt(ux * ux + uy * uy);
      var mod = (ux + uy) % 0.2;
      if (mod < 0) mod += 0.2;
      var sum = 0;
      for (var j = 0; j < 3; j++) {
        var c = 0;
        for (var i = 0; i < 5; i++) {
          var f = t - 0.01 * j + 0.01 * i;
          f -= Math.floor(f); // fract
          c += 0.002 * (i * i) / Math.abs(f * 5 - len + mod);
        }
        sum += Math.min(c, 2);
      }
      // same center attenuation as the fragment shader (keep in sync)
      var er = Math.sqrt(ux * 0.62 * ux * 0.62 + uy * uy);
      var s = Math.min(1, Math.max(0, (er - 0.18) / (0.62 - 0.18)));
      s = s * s * (3 - 2 * s); // smoothstep
      return Math.min(1, sum / 2.4) * (0.12 + 0.88 * s);
    }

    function updateRims(time) {
      if (!hero) return;
      var hw = hero.offsetWidth;
      var hh = hero.offsetHeight;
      if (!hw || !hh) return;

      for (var k = 0; k < rimTargets.length; k++) {
        var target = rimTargets[k];
        // scroll-reactive: weight each bin by how squarely it faces the
        // viewport light, so the bright arc sweeps as the element scrolls
        var phi = viewportLightAngle(target.el);
        var alphas = [];
        var maxB = 0;
        for (var b = 0; b < RIM_BINS; b++) {
          // conic gradients start at 12 o'clock and run clockwise
          var theta = (b / RIM_BINS) * Math.PI * 2;
          var px = target.cx + Math.sin(theta) * target.rx;
          var py = target.cy - Math.cos(theta) * target.ry;
          var bright = sampleShader(px, py, hw, hh, time);
          var facing = Math.max(0, Math.cos(theta - phi));
          bright *= 0.4 + 0.6 * facing;
          if (bright > maxB) maxB = bright;
          alphas.push(0.03 + bright * 0.45);
        }
        var stops = [];
        for (b = 0; b <= RIM_BINS; b++) {
          stops.push('rgba(255,255,255,' + alphas[b % RIM_BINS].toFixed(3) + ') ' +
                     ((b / RIM_BINS) * 360).toFixed(1) + 'deg');
        }
        target.el.style.setProperty('--rim-gradient',
          'conic-gradient(from 0deg at 50% 50%, ' + stops.join(', ') + ')');
        target.el.style.setProperty('--rim-intensity', maxB.toFixed(3));
      }
    }

    var rimFrame = 0;
    function rimHook(time) {
      rimFrame++;
      if (rimFrame % 3) return; // ~20fps is plenty for a reflection
      updateRims(time);
    }

    /* ---- Scroll-reactive rims: a fixed scene light hangs above the
       viewport's top center. As glass travels past it while scrolling,
       the specular arc sweeps around the border, and scroll velocity
       briefly flares its brightness before it settles. ---- */
    var scrollTargets = []; // glass outside the hero (no shader to sample)
    var REST_BOOST = 0.3;
    var rimBoost = REST_BOOST;

    // conic-convention angle (0 = 12 o'clock, clockwise) from the
    // element's viewport center toward the scene light
    function viewportLightAngle(el) {
      var r = el.getBoundingClientRect();
      var dx = window.innerWidth / 2 - (r.left + r.width / 2);
      var dy = -window.innerHeight * 0.25 - (r.top + r.height / 2);
      return Math.atan2(dx, -dy);
    }

    function scrollRimGradient(phi, boost) {
      var stops = [];
      for (var b = 0; b <= RIM_BINS; b++) {
        var theta = ((b % RIM_BINS) / RIM_BINS) * Math.PI * 2;
        var facing = Math.max(0, Math.cos(theta - phi));
        var a = 0.04 + facing * facing * (0.08 + 0.38 * boost);
        stops.push('rgba(255,255,255,' + a.toFixed(3) + ') ' +
                   ((b / RIM_BINS) * 360).toFixed(1) + 'deg');
      }
      return 'conic-gradient(from 0deg at 50% 50%, ' + stops.join(', ') + ')';
    }

    function updateScrollRims() {
      var vh = window.innerHeight;
      for (var k = 0; k < scrollTargets.length; k++) {
        var el = scrollTargets[k].el;
        var r = el.getBoundingClientRect();
        if (!r.width || r.bottom < -80 || r.top > vh + 80) continue;
        el.style.setProperty('--rim-gradient', scrollRimGradient(viewportLightAngle(el), rimBoost));
        el.style.setProperty('--rim-intensity', (0.2 + rimBoost * 0.5).toFixed(3));
      }
    }

    // velocity flare: spikes with scroll speed, decays back to rest
    var scrollTicking = false;
    var lastScrollY = window.pageYOffset;
    function scrollRimTick() {
      updateScrollRims();
      if (rimBoost > REST_BOOST + 0.01) {
        rimBoost = REST_BOOST + (rimBoost - REST_BOOST) * 0.88;
        requestAnimationFrame(scrollRimTick);
      } else {
        rimBoost = REST_BOOST;
        scrollTicking = false;
      }
    }
    function onScrollRims() {
      var y = window.pageYOffset;
      rimBoost = Math.min(1, Math.max(rimBoost, REST_BOOST + Math.abs(y - lastScrollY) / 60));
      lastScrollY = y;
      if (!scrollTicking) {
        scrollTicking = true;
        requestAnimationFrame(scrollRimTick);
      }
    }

    // Faint top-lit ring for glass sitting on the flat void (contact
    // button, project flyout panel): dark edge, no white outline.
    var DIM_RIM = 'conic-gradient(from 0deg at 50% 50%, ' +
      'rgba(255,255,255,0.10) 0deg, rgba(255,255,255,0.03) 100deg, ' +
      'rgba(255,255,255,0.02) 180deg, rgba(255,255,255,0.03) 260deg, ' +
      'rgba(255,255,255,0.10) 360deg)';

    function refresh() {
      try {
        var lensImages = [];
        rimTargets = [];
        scrollTargets = [];

        glasses.forEach(function (el) {
          var w = el.offsetWidth;
          var h = el.offsetHeight;
          if (!w || !h) return;
          var map = generateConvexMap(w, h);
          if (!map) return;

          var inHero = hero && hero.contains(el);
          var pos = inHero ? offsetWithin(el, hero) : null;

          // light azimuth from the element's center toward the scene light
          var lightAz = Math.PI / 2; // straight above, for elements outside the hero
          if (inHero && hero.offsetWidth && hero.offsetHeight) {
            var cx = (pos.x + w / 2) / hero.offsetWidth;
            var cy = (pos.y + h / 2) / hero.offsetHeight;
            lightAz = Math.atan2(LIGHT.y - cy, LIGHT.x - cx);
          }

          var a = analyzeRefraction(map, lightAz);
          if (a) {
            var intensity = 0.4 + a.magnitude * 0.6;
            var cosV = -Math.cos(a.domAngle) * intensity;
            var sinV = -Math.sin(a.domAngle) * intensity;
            el.style.setProperty('--glass-bevel', bevelShadow(cosV, sinV, a.magnitude));
          }

          if (inHero && heroShaderActive) {
            // rim starts dark; the shader hook lights it up per frame
            el.style.setProperty('--rim-gradient', DIM_RIM);
            el.style.setProperty('--rim-intensity', '0.1');
            rimTargets.push({ el: el, cx: pos.x + w / 2, cy: pos.y + h / 2, rx: w / 2, ry: h / 2 });
          } else {
            el.style.setProperty('--rim-gradient', DIM_RIM);
            el.style.setProperty('--rim-intensity', '0.25');
            scrollTargets.push({ el: el });
          }

          if (inHero) lensImages.push({ map: map, x: pos.x, y: pos.y, w: w, h: h });
        });

        mountLenses(lensImages);

        updateScrollRims(); // settle non-hero rims onto the scene light
        if (reducedMotion && heroShaderActive) updateRims(40.0);
      } catch (err) {
        // any failure: skip the refraction, the CSS glass stands alone
        if (heroCanvas) heroCanvas.style.filter = '';
      }
    }

    // Rebuild the #hero-lens filter: one feImage per glass element in
    // the hero, merged over the neutral flood, one displacement map.
    function mountLenses(lensImages) {
      if (!heroCanvas || !lensFilter || !lensImages.length) return;

      var merge = lensFilter.querySelector('feMerge');
      if (!merge) return;

      // clear lenses from a previous pass (resize)
      Array.prototype.slice.call(lensFilter.querySelectorAll('feImage')).forEach(function (n) { n.remove(); });
      Array.prototype.slice.call(merge.querySelectorAll('feMergeNode')).slice(1).forEach(function (n) { n.remove(); });

      var flood = lensFilter.querySelector('feFlood');
      lensImages.forEach(function (lens, idx) {
        var img = document.createElementNS(SVG_NS, 'feImage');
        img.setAttribute('href', lens.map.url);
        img.setAttributeNS(XLINK_NS, 'xlink:href', lens.map.url);
        img.setAttribute('x', lens.x);
        img.setAttribute('y', lens.y);
        img.setAttribute('width', lens.w);
        img.setAttribute('height', lens.h);
        img.setAttribute('preserveAspectRatio', 'none');
        img.setAttribute('result', 'lens' + idx);
        lensFilter.insertBefore(img, flood);

        var node = document.createElementNS(SVG_NS, 'feMergeNode');
        node.setAttribute('in', 'lens' + idx);
        merge.appendChild(node);
      });

      heroCanvas.style.filter = 'url(#hero-lens)';
    }

    function start() {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(refresh);
      } else {
        refresh();
      }
      if (!reducedMotion) {
        frameHooks.push(rimHook);
        window.addEventListener('scroll', onScrollRims, { passive: true });
      }
    }
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start);

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(refresh, 200);
    }, { passive: true });
  })();

  /* ================================================================
     Glass button click ripple (hover/click only, D26)
     ================================================================ */
  (function initGlassRipples() {
    // delegated, so pills injected into the project flyout ripple too
    document.addEventListener('click', function (e) {
      if (reducedMotion) return;
      var btn = e.target.closest ? e.target.closest('.btn-glass') : null;
      if (!btn) return;
      var rect = btn.getBoundingClientRect();
      var ripple = document.createElement('span');
      ripple.className = 'btn-glass__ripple';
      ripple.style.left = (e.clientX - rect.left) + 'px';
      ripple.style.top = (e.clientY - rect.top) + 'px';
      btn.appendChild(ripple);
      setTimeout(function () { ripple.remove(); }, 650);
    });
  })();

  /* ================================================================
     Hero phrase rotator (D31): scrolls through the intro phrases once
     after load and settles on the name. One-shot, never loops (D26).
     ================================================================ */
  (function initHeroRotator() {
    var list = document.querySelector('.rotator__list');
    if (!list) return;
    var last = list.children.length - 1;

    // once a phrase has scrolled away, hide it outright: its descenders
    // hang below its line box and would otherwise peek into the top of
    // the rotator window
    function hideAbove(count) {
      for (var j = 0; j < count; j++) list.children[j].style.visibility = 'hidden';
    }

    if (reducedMotion) {
      list.style.setProperty('--ri', last);
      hideAbove(last);
      return;
    }

    // the opening phrase holds a full second longer than the rest
    var i = 0;
    function step() {
      i += 1;
      list.style.setProperty('--ri', i);
      (function (done) {
        setTimeout(function () { hideAbove(done); }, 650); // after the 0.55s slide
      })(i);
      if (i < last) setTimeout(step, 1900);
    }
    setTimeout(step, 2900);
  })();

  /* ================================================================
     Entrance animations: everything plays once right after load
     (no scroll-triggered animation on the page, D26).
     ================================================================ */
  var revealEls = document.querySelectorAll('.reveal');
  revealEls.forEach(function (el, i) {
    el.style.setProperty('--d', ((i % 4) * 0.08) + 's');
  });
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      revealEls.forEach(function (el) { el.classList.add('in'); });
    });
  });

  /* ================================================================
     Project flyout (D35): clicking a card makes its detail fly out of
     the card and expand front and center as a liquid glass panel.
     Esc, X, or the backdrop closes it (it flies back into its card).
     No prev/next: one project at a time.
     ================================================================ */
  (function initProjectOverlay() {
    var overlay = document.querySelector('.project-overlay');
    if (!overlay) return;

    var cards = Array.prototype.slice.call(document.querySelectorAll('.pcard'));
    var templates = Array.prototype.slice.call(document.querySelectorAll('template.project-detail'));
    var panel = overlay.querySelector('.project-overlay__panel');
    var titleEl = overlay.querySelector('.project-overlay__title');
    var datesEl = overlay.querySelector('.project-overlay__dates');
    var stackEl = overlay.querySelector('.project-overlay__stack');
    var bodyEl = overlay.querySelector('.project-overlay__body');
    var closeBtn = overlay.querySelector('.project-overlay__close');

    var sourceCard = null;
    var lastFocused = null;
    var closing = false;

    function fill(index, card) {
      var tpl = templates[index];
      titleEl.innerHTML = tpl.dataset.title;
      // carry the card's worked-on dates into the flyout
      var dates = card ? card.querySelector('.pcard__dates') : null;
      if (datesEl) {
        datesEl.textContent = dates ? dates.textContent : '';
        datesEl.hidden = !dates;
      }
      // carry the card's skills into the flyout as chips
      var stack = card ? card.querySelector('.pcard__stack') : null;
      if (stackEl) {
        stackEl.innerHTML = '';
        if (stack) {
          stack.textContent.split('·').forEach(function (skill) {
            skill = skill.trim();
            if (!skill) return;
            var tag = document.createElement('span');
            tag.className = 'skills__tag';
            tag.textContent = skill;
            stackEl.appendChild(tag);
          });
        }
      }
      bodyEl.innerHTML = '';
      bodyEl.appendChild(tpl.content.cloneNode(true));
    }

    // FLIP: transform that puts the centered panel back onto the card
    function transformToCard() {
      var c = sourceCard.getBoundingClientRect();
      var p = panel.getBoundingClientRect();
      var dx = (c.left + c.width / 2) - (p.left + p.width / 2);
      var dy = (c.top + c.height / 2) - (p.top + p.height / 2);
      var sx = c.width / p.width;
      var sy = c.height / p.height;
      return 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) ' +
             'scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
    }

    function open(index, card) {
      sourceCard = card;
      closing = false;
      fill(index, card);
      lastFocused = document.activeElement;
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';

      if (reducedMotion) {
        overlay.classList.add('show');
        closeBtn.focus();
        return;
      }

      // start collapsed onto the clicked card, then release to center
      panel.style.transition = 'none';
      panel.style.transform = transformToCard();
      panel.style.opacity = '0.35';
      requestAnimationFrame(function () {
        overlay.classList.add('show');
        requestAnimationFrame(function () {
          panel.style.transition = '';
          panel.style.transform = '';
          panel.style.opacity = '';
        });
      });
      closeBtn.focus();
    }

    function close() {
      if (overlay.hidden || closing) return;
      document.body.style.overflow = '';

      if (reducedMotion || !sourceCard) {
        overlay.classList.remove('show');
        overlay.hidden = true;
      } else {
        // fly back into the originating card
        closing = true;
        panel.style.transform = transformToCard();
        panel.style.opacity = '0';
        overlay.classList.remove('show');
        setTimeout(function () {
          overlay.hidden = true;
          closing = false;
          panel.style.transition = 'none';
          panel.style.transform = '';
          panel.style.opacity = '';
          void panel.offsetWidth; // commit before re-enabling transitions
          panel.style.transition = '';
        }, 400);
      }
      if (lastFocused) lastFocused.focus();
    }

    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        open(parseInt(card.dataset.project, 10), card);
      });
    });

    closeBtn.addEventListener('click', close);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    document.addEventListener('keydown', function (e) {
      if (overlay.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') {
        // keep focus inside the dialog
        var focusables = overlay.querySelectorAll('button, a[href]');
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  })();
})();
