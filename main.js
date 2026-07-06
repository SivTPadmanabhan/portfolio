// Sivaditya Padmanabhan - portfolio interactions
// One continuous animation on the page: the hero ring shader (D25).
// Everything else fires once after load or on hover/click only (D26).

(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      '  gl_FragColor = vec4(color[0],color[1],color[2],1.0);\n' +
      '}';

    var shader = mountShader(canvas, fragmentSrc);
    if (!shader) return; // no WebGL: hero simply stays black

    var shaderTime = 1.0; // uniform starts at 1.0 in the original

    if (reducedMotion) {
      shader.draw(40.0); // a pleasing static frame
      return;
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

    function buildConicGradient(profile, fromDeg) {
      var stops = [];
      for (var b = 0; b <= BINS; b++) {
        var t = profile[b % BINS];
        var deg = (b / BINS) * 360;
        var op = (0.07 + t * 0.63).toFixed(3);
        stops.push('rgba(255,255,255,' + op + ') ' + deg.toFixed(1) + 'deg');
      }
      return 'conic-gradient(from ' + fromDeg.toFixed(1) + 'deg at 50% 50%, ' + stops.join(', ') + ')';
    }

    // The component's ten-layer bevel with color-mix() resolved to rgba
    function bevelShadow(cos, sin, rim) {
      function px(v) { return v.toFixed(2) + 'px'; }
      function white(a) { return 'rgba(255,255,255,' + a.toFixed(3) + ')'; }
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

    function refresh() {
      try {
        var lensImages = [];

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
            var lightAngleDeg = (a.domAngle * 180) / Math.PI + 90;
            el.style.setProperty('--rim-gradient', buildConicGradient(a.profile, lightAngleDeg));
            el.style.setProperty('--rim-intensity', String(a.magnitude));
            el.style.setProperty('--glass-bevel', bevelShadow(cosV, sinV, a.magnitude));
          }

          if (inHero) lensImages.push({ map: map, x: pos.x, y: pos.y, w: w, h: h });
        });

        mountLenses(lensImages);
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
    var buttons = Array.prototype.slice.call(document.querySelectorAll('.btn-glass'));
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (reducedMotion) return;
        var rect = btn.getBoundingClientRect();
        var ripple = document.createElement('span');
        ripple.className = 'btn-glass__ripple';
        ripple.style.left = (e.clientX - rect.left) + 'px';
        ripple.style.top = (e.clientY - rect.top) + 'px';
        btn.appendChild(ripple);
        setTimeout(function () { ripple.remove(); }, 650);
      });
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

    if (reducedMotion) {
      list.style.setProperty('--ri', last);
      return;
    }

    var i = 0;
    var timer = setInterval(function () {
      i += 1;
      list.style.setProperty('--ri', i);
      if (i >= last) clearInterval(timer);
    }, 900);
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
     Project overlay: click a card to open, arrows / arrow keys flip
     between projects with a 3D flip, Esc or X or backdrop closes.
     ================================================================ */
  (function initProjectOverlay() {
    var overlay = document.querySelector('.project-overlay');
    if (!overlay) return;

    var cards = Array.prototype.slice.call(document.querySelectorAll('.pcard'));
    var templates = Array.prototype.slice.call(document.querySelectorAll('template.project-detail'));
    var flipCard = overlay.querySelector('.project-overlay__card');
    var titleEl = overlay.querySelector('.project-overlay__title');
    var counterEl = overlay.querySelector('.project-overlay__counter');
    var bodyEl = overlay.querySelector('.project-overlay__body');
    var closeBtn = overlay.querySelector('.project-overlay__close');
    var prevBtn = overlay.querySelector('.project-overlay__nav--prev');
    var nextBtn = overlay.querySelector('.project-overlay__nav--next');

    var current = 0;
    var flipping = false;
    var lastFocused = null;

    function fill(index) {
      var tpl = templates[index];
      titleEl.innerHTML = tpl.dataset.title;
      counterEl.textContent = (index + 1) + ' / ' + templates.length;
      bodyEl.innerHTML = '';
      bodyEl.appendChild(tpl.content.cloneNode(true));
      current = index;
    }

    function open(index) {
      fill(index);
      lastFocused = document.activeElement;
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
      // let the browser paint the hidden->shown frame before fading in
      requestAnimationFrame(function () { overlay.classList.add('show'); });
      closeBtn.focus();
    }

    function close() {
      overlay.classList.remove('show');
      document.body.style.overflow = '';
      var done = function () { overlay.hidden = true; };
      if (reducedMotion) done(); else setTimeout(done, 300);
      if (lastFocused) lastFocused.focus();
    }

    function flipTo(index, dir) {
      index = (index + templates.length) % templates.length;
      if (flipping || index === current) return;

      if (reducedMotion) {
        fill(index);
        return;
      }

      flipping = true;
      flipCard.classList.add(dir === 1 ? 'flip-next' : 'flip-prev');
      setTimeout(function () { fill(index); }, 300); // swap at the 90deg midpoint
      setTimeout(function () {
        flipCard.classList.remove('flip-next', 'flip-prev');
        flipping = false;
      }, 600);
    }

    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        open(parseInt(card.dataset.project, 10));
      });
    });

    closeBtn.addEventListener('click', close);
    prevBtn.addEventListener('click', function () { flipTo(current - 1, -1); });
    nextBtn.addEventListener('click', function () { flipTo(current + 1, 1); });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    document.addEventListener('keydown', function (e) {
      if (overlay.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowLeft') { flipTo(current - 1, -1); return; }
      if (e.key === 'ArrowRight') { flipTo(current + 1, 1); return; }
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

  /* ================================================================
     Contact form
     No backend is wired up yet. The form opens the visitor's own mail
     app with the message pre-filled. The address is assembled at runtime
     so it never appears in the page source as plain text.
     ================================================================ */
  var form = document.getElementById('contact-form');
  var successMsg = form.querySelector('.form-msg--success');
  var errorMsg = form.querySelector('.form-msg--error');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    successMsg.hidden = true;
    errorMsg.hidden = true;

    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var message = form.message.value.trim();

    if (!name || !email || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorMsg.hidden = false;
      return;
    }

    try {
      var addr = ['stpadmanabhan2448', 'gmail.com'].join('@');
      var subject = encodeURIComponent('Portfolio message from ' + name);
      var body = encodeURIComponent(message + '\n\nFrom: ' + name + ' <' + email + '>');
      window.location.href = 'mailto:' + addr + '?subject=' + subject + '&body=' + body;
      successMsg.hidden = false;
      form.reset();
    } catch (err) {
      errorMsg.hidden = false;
    }
  });
})();
