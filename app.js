(function () {
  'use strict';

  var INDEX = window.INDEX || [];
  var CATS = window.CATS || [];
  // ensure window.CHUNKS and the local reference share the same object,
  // so lazily-loaded chunk scripts (which mutate window.CHUNKS) are visible here
  window.CHUNKS = window.CHUNKS || {};
  var CHUNKS = window.CHUNKS;
  var PAGE = 60;

  var state = { mode: 'desc', cat: '', type: '', size: 'm' };
  var listIdx = [];   // index entries matching current filter
  var pos = 0;
  var lbIdx = 0;
  var lbOpen = false;
  var lbHls = null;
  var loadedChunks = new Set();

  var grid = document.getElementById('grid');
  var sentinel = document.getElementById('sentinel');
  var statusEl = document.getElementById('status');
  var brandTotal = document.getElementById('total');
  var catSel = document.getElementById('cat');
  var modeSel = document.getElementById('mode');
  var typeSel = document.getElementById('type');
  var shuffleBtn = document.getElementById('shuffle');
  var lightbox = document.getElementById('lightbox');
  var stage = document.getElementById('lb-stage');
  var lbInfo = document.getElementById('lb-info');
  var openLink = document.getElementById('lb-open');
  var dlLink = document.getElementById('lb-download');

  var io = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) renderPage();
  }, { rootMargin: '1200px' });

  // ---- video: only play when visible AND hovered ----
  var vio = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var v = en.target;
      if (!v.isConnected) return;
      if (en.isIntersecting) {
        v.dataset.visible = '1';
        maybePlay(v);
      } else {
        v.dataset.visible = '';
        v.pause();
      }
    });
  }, { rootMargin: '200px' });

  function maybePlay(v) {
    if (v.dataset.visible !== '1') return;
    if (v.dataset.hover !== '1') return; // only play on hover
    if (v.readyState === 0) { v.preload = 'auto'; v.load(); }
    v.play().catch(function () {});
  }

  function matches(it) {
    if (state.cat !== '' && it.c !== state.cat) return false;
    if (state.type && it.t !== state.type) return false;
    return true;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
  }

  function buildListIdx() {
    var arr = INDEX.filter(matches);
    if (state.mode === 'random') {
      shuffle(arr);
    } else if (state.mode === 'desc') {
      arr.reverse();
    }
    return arr;
  }

  function loadChunk(k) {
    if (loadedChunks.has(k)) return Promise.resolve();
    if (CHUNKS[k]) { loadedChunks.add(k); return Promise.resolve(); }
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'data/' + k + '.js';
      s.onload = function () { loadedChunks.add(k); resolve(); };
      s.onerror = function () { reject(new Error('chunk ' + k + ' failed')); };
      document.head.appendChild(s);
    });
  }

  // chunks that failed to load (skip them instead of stalling)
  var failedChunks = new Set();

  function itemAt(idx) {
    var it = listIdx[idx];
    if (!it) return null;
    var chunk = CHUNKS[it.k];
    if (!chunk) return null;
    return chunk[it.o] || null;
  }

  function phEl(msg) {
    var d = document.createElement('div');
    d.className = 'ph';
    d.textContent = msg;
    return d;
  }

  function playIcon() {
    var s = document.createElement('span');
    s.className = 'play';
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)"><path d="M8 5v14l11-7z"/></svg>';
    return s;
  }

  function makeTile(item, idx) {
    var a = document.createElement('a');
    a.className = 'tile';
    a.href = item.u;
    a.dataset.idx = String(idx);
    a.addEventListener('click', function (e) {
      e.preventDefault();
      openLb(idx);
    });
    if (item.t === 'v') {
      if (/\.m3u8$/i.test(item.p)) {
        a.appendChild(phEl('M3U8'));
        a.appendChild(playIcon());
      } else {
        var v = document.createElement('video');
        v.preload = 'none';
        v.loop = true;
        v.muted = true;
        v.playsInline = true;
        v.alt = item.p;
        v.src = item.u;
        var attempts = 0;
        var stallTimer = null;
        function fail() {
          if (v.parentNode !== a || v.readyState >= 2) return;
          if (attempts >= 2) {
            a.replaceChild(phEl('无法加载'), v);
            return;
          }
          attempts++;
          v.load();
          maybePlay(v);
          stallTimer = setTimeout(fail, 25000);
        }
        stallTimer = setTimeout(fail, 25000);
        v.addEventListener('playing', function () { clearTimeout(stallTimer); });
        v.addEventListener('error', function () {
          clearTimeout(stallTimer);
          fail();
        });
        a.addEventListener('mouseenter', function () { v.dataset.hover = '1'; maybePlay(v); });
        a.addEventListener('mouseleave', function () { v.dataset.hover = ''; v.pause(); });
        vio.observe(v);
        a.appendChild(v);
        a.appendChild(playIcon());
      }
    } else {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = item.p;
      img.src = item.u;
      img.addEventListener('error', function () {
        a.replaceChild(phEl('无法加载'), img);
      });
      a.appendChild(img);
    }
    return a;
  }

  function renderPage() {
    if (pos >= listIdx.length) {
      io.disconnect();
      statusEl.textContent = listIdx.length ? '已全部加载 ' + listIdx.length + ' 条' : '没有匹配的内容';
      return;
    }
    var frag = document.createDocumentFragment();
    var end = Math.min(pos + PAGE, listIdx.length);
    for (var i = pos; i < end; i++) {
      var it = listIdx[i];
      if (!CHUNKS[it.k]) {
        if (failedChunks.has(it.k)) continue; // skip failed chunk
        loadChunk(it.k).then(function () { renderPage(); })
          .catch(function () { failedChunks.add(it.k); renderPage(); });
        return;
      }
      var item = itemAt(i);
      if (item) frag.appendChild(makeTile(item, i));
    }
    grid.appendChild(frag);
    pos = end;
    statusEl.textContent = '已加载 ' + pos + ' / ' + listIdx.length;
  }

  function apply() {
    listIdx = buildListIdx();
    pos = 0;
    grid.innerHTML = '';
    io.disconnect();
    io.observe(sentinel);
    renderPage();
    shuffleBtn.hidden = state.mode !== 'random';
    saveState();
  }

  function initCats() {
    var counts = {};
    INDEX.forEach(function (it) { counts[it.c] = (counts[it.c] || 0) + 1; });
    var ids = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a]; });
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '全部 (' + INDEX.length + ')';
    catSel.appendChild(opt);
    ids.forEach(function (id) {
      var o = document.createElement('option');
      o.value = String(id);
      o.textContent = CATS[id] + ' (' + counts[id] + ')';
      catSel.appendChild(o);
    });
    brandTotal.textContent = INDEX.length;
  }

  function saveState() {
    history.replaceState(null, '', '#' + [state.mode, state.cat, state.type, state.size].map(encodeURIComponent).join('/'));
  }

  function loadState() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var parts = h.split('/').map(decodeURIComponent);
    if (parts[0] === 'random' || parts[0] === 'asc' || parts[0] === 'desc') state.mode = parts[0];
    if (parts.length > 1) state.cat = parts[1] === '' ? '' : Number(parts[1]);
    if (parts.length > 2 && (parts[2] === 'i' || parts[2] === 'v')) state.type = parts[2];
    if (parts.length > 3 && (parts[3] === 's' || parts[3] === 'm' || parts[3] === 'l' || parts[3] === 'xl' || parts[3] === 'xxl')) state.size = parts[3];
  }

  function openLb(idx) {
    lbIdx = idx;
    lbOpen = true;
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    showLbItem();
  }

  function destroyLbHls() {
    if (lbHls) { try { lbHls.destroy(); } catch (e) {} lbHls = null; }
  }

  function closeLb() {
    lbOpen = false;
    lightbox.hidden = true;
    document.body.style.overflow = '';
    destroyLbHls();
    stage.innerHTML = '';
  }

  function showLbItem() {
    var item = itemAt(lbIdx);
    if (!item) return;
    var fname = item.p.split('/').pop();
    lbInfo.textContent = (lbIdx + 1) + ' / ' + listIdx.length + ' · ' + item.c + ' · ' + fname;
    openLink.href = item.u;
    dlLink.href = item.u;
    destroyLbHls();
    stage.innerHTML = '';
    if (item.t === 'v') {
      var v = document.createElement('video');
      v.controls = true;
      v.autoplay = true;
      v.src = item.u;
      if (/\.m3u8$/i.test(item.p)) {
        if (window.Hls && Hls.isSupported()) {
          lbHls = new Hls();
          lbHls.loadSource(item.u);
          lbHls.attachMedia(v);
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = item.u;
        } else {
          var d = document.createElement('div');
          d.className = 'lb-msg';
          d.textContent = '当前浏览器无法播放 m3u8，请点击右上角"下载"';
          stage.appendChild(d);
          return;
        }
      }
      stage.appendChild(v);
      v.play().catch(function () {});
    } else {
      var img = document.createElement('img');
      img.src = item.u;
      img.alt = item.p;
      stage.appendChild(img);
    }
  }

  function stepLb(dir) {
    if (!listIdx.length) return;
    lbIdx = (lbIdx + dir + listIdx.length) % listIdx.length;
    showLbItem();
  }

  modeSel.addEventListener('change', function () {
    state.mode = modeSel.value;
    apply();
  });

  catSel.addEventListener('change', function () {
    state.cat = catSel.value === '' ? '' : Number(catSel.value);
    apply();
  });

  typeSel.addEventListener('change', function () {
    state.type = typeSel.value;
    apply();
  });

  shuffleBtn.addEventListener('click', function () {
    listIdx = buildListIdx();
    pos = 0;
    grid.innerHTML = '';
    renderPage();
    statusEl.textContent = '已洗牌';
  });

  document.getElementById('sizes').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    state.size = btn.dataset.size;
    grid.className = 'size-' + state.size;
    document.querySelectorAll('.size-btns button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    saveState();
  });

  document.getElementById('lb-close').addEventListener('click', closeLb);
  document.querySelector('.lb-prev').addEventListener('click', function () { stepLb(-1); });
  document.querySelector('.lb-next').addEventListener('click', function () { stepLb(1); });

  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox) closeLb();
  });

  document.addEventListener('keydown', function (e) {
    if (!lbOpen) return;
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowLeft') stepLb(-1);
    else if (e.key === 'ArrowRight') stepLb(1);
  });

  initCats();
  loadState();
  modeSel.value = state.mode;
  catSel.value = state.cat === '' ? '' : String(state.cat);
  typeSel.value = state.type;
  grid.className = 'size-' + state.size;
  document.querySelectorAll('.size-btns button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.size === state.size);
  });
  apply();
})();
