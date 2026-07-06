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
     Liquid glass buttons (D30): all the glass work is CSS + the SVG
     distortion filter. JS only adds the click ripple.
     ================================================================ */
  (function initGlassButtons() {
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
