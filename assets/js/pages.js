/* ==========================================================================
   Reviews / About 页面的数据层。

   测评：公开数据存在 public/reviews.json，访客直接 fetch 这份文件；
         站长浏览器里有 GitHub Token 时改走 Contents API，保存后立即成为公开数据。
   介绍：存在 public/site.json 的 profile.intro，由 app.js 的名片编辑器统一维护。
   留言：本版本已移除评论功能，About 页只保留介绍与链接。
   ========================================================================== */
(function () {
  'use strict';

  var REVIEWS_PATH = 'public/reviews.json';

  var CATEGORY_LABELS = { game: '游戏', film: '影视', book: '书籍' };

  var reviews = [];
  var reviewSource = 'public'; /* public | github | empty */
  var currentFilter = 'all';

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function coverUrl(url) { return encodeURI(String(url || '').trim()); }
  function pad2(value) { return String(Number(value || 0)).padStart(2, '0'); }

  function githubConfig() {
    return (window.GitHubStore && window.GitHubStore.load) ? window.GitHubStore.load() : null;
  }

  function toast(message, type) {
    var wrap = document.getElementById('toasts');
    if (!wrap) return;
    var kind = type || 'success';
    var name = kind === 'error' ? 'x' : kind === 'info' ? 'sparkle' : 'check';
    var node = document.createElement('div');
    node.className = 'toast' + (kind === 'error' ? ' is-error' : kind === 'info' ? ' is-info' : '');
    node.innerHTML = '<svg class="icon"><use href="#i-' + name + '"></use></svg><span>' + esc(message) + '</span>';
    wrap.appendChild(node);
    while (wrap.children.length > 4) wrap.firstElementChild.remove();
    setTimeout(function () {
      node.classList.add('is-leaving');
      setTimeout(function () { node.remove(); }, 300);
    }, 4200);
  }

  /* ---- 读取：站长走 API，访客读 public/reviews.json ---- */
  async function loadReviews() {
    var config = githubConfig();
    if (config) {
      try {
        var manifest = await window.GitHubStore.readReviews(config);
        return { rows: manifest.reviews, source: 'github' };
      } catch (error) {
        console.warn('GitHub 测评读取失败，回退到 Pages 文件', error);
      }
    }
    try {
      var response = await fetch(REVIEWS_PATH + '?v=' + Date.now(), { cache: 'no-store' });
      if (response.ok) {
        var data = await response.json();
        return { rows: Array.isArray(data.reviews) ? data.reviews : [], source: 'public' };
      }
    } catch (error) {
      console.warn('public/reviews.json 读取失败', error);
    }
    /* 读不到文件就当没有数据：宁可显示空态，也不要拿示例内容糊弄访客 */
    console.warn('没读到 public/reviews.json，按“还没有测评”处理');
    return { rows: [], source: 'empty' };
  }

  function scoreClass(score) {
    var n = Number(score);
    if (n < 6) return 'low';
    if (n < 8) return 'mid';
    if (n < 9) return 'light';
    return 'high';
  }
  function categoryCount(cat) {
    return reviews.filter(function (r) { return r.category === cat; }).length;
  }

  function syncCounts() {
    var count = parseFloat(reviews.length) || 0;
    var pageCount = document.getElementById('reviewCount');
    if (pageCount) pageCount.textContent = pad2(count);
    var heroCount = document.getElementById('heroReviewCount');
    if (heroCount) heroCount.textContent = String(count);
    window.__atlasReviews = reviews;
  }

  function renderFilters() {
    var wrap = document.getElementById('reviewFilters');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-review-filter]'), function (btn) {
      var key = btn.getAttribute('data-review-filter');
      var b = btn.querySelector('b');
      if (b) b.textContent = key === 'all' ? reviews.length : categoryCount(key);
      btn.classList.toggle('is-active', key === currentFilter);
    });
  }

  function renderReviews(filter) {
    var list = document.getElementById('reviewList');
    if (!list) return;
    currentFilter = filter || 'all';
    var rows = reviews.filter(function (r) { return currentFilter === 'all' || r.category === currentFilter; });
    var canManage = reviewSource === 'github';

    list.innerHTML = '';
    var empty = document.getElementById('reviewsEmpty');
    if (empty) {
      empty.hidden = rows.length !== 0;
      var emptyTitle = empty.querySelector('h3');
      var emptyText = empty.querySelector('p');
      if (emptyTitle && emptyText) {
        if (currentFilter === 'all') {
          emptyTitle.textContent = '还没有测评';
          emptyText.textContent = '写第一篇测评，把感受留下来。';
        } else {
          emptyTitle.textContent = '这个分类下还没有';
          emptyText.textContent = '换个分类看看，或者先写一篇。';
        }
      }
    }
    syncCounts();

    rows.forEach(function (r) {
      var card = document.createElement('article');
      card.className = 'review-card';
      card.setAttribute('data-id', r.id || '');
      card.innerHTML =
        '<div class="review-cover"><img src="' + esc(coverUrl(r.cover)) + '" alt="" loading="lazy">' +
          '<div class="review-score ' + scoreClass(r.score) + '">' + Number(r.score).toFixed(1) + '</div></div>' +
        '<div class="review-body">' +
          '<div class="review-meta">' + esc(r.categoryLabel || CATEGORY_LABELS[r.category] || '测评') + ' REVIEW · 2026</div>' +
          '<h3>' + esc(r.title) + '</h3>' +
          '<p class="review-sub">' + esc(r.sub || '') + '</p>' +
          '<p class="review-text">' + esc(r.text) + '</p>' +
          '<button class="review-toggle" type="button">展开全文</button>' +
          '<div class="review-foot">' +
            '<span>' + Number(r.score).toFixed(1) + ' / 10</span>' +
            (canManage ? '<button class="review-del owner-only" type="button">删除</button>' : '') +
          '</div>' +
        '</div>';

      var text = card.querySelector('.review-text');
      var toggle = card.querySelector('.review-toggle');
      toggle.addEventListener('click', function () {
        var open = text.classList.toggle('is-open');
        toggle.textContent = open ? '收起' : '展开全文';
      });

      var del = card.querySelector('.review-del');
      if (del) del.addEventListener('click', function () { removeReview(r); });

      list.appendChild(card);
    });

    renderFilters();
    watchReviews();
    scheduleReviewToggles();
  }

  async function removeReview(review) {
    var config = githubConfig();
    if (!config) {
      toast('删除测评需要先配置 GitHub Token', 'error');
      return;
    }
    if (!window.confirm('删除《' + (review.title || '这条测评') + '》？它的封面图也会一起从仓库删除，访客会立即看不到它。')) return;
    try {
      var removed = await window.GitHubStore.removeReview(config, review);
      reviews = reviews.filter(function (item) { return item.id !== review.id; });
      renderReviews(currentFilter);
      toast(removed && removed.length ? '测评和封面已从仓库删除，约 1 分钟后同步' : '已删除，大约 1 分钟后 GitHub Pages 同步');
    } catch (error) {
      toast(error.message || '删除失败', 'error');
    }
  }

  /* ---- 最近动态：用真实数据（说说 + 测评）按时间倒序取 3 条 ---- */
  var recentLogs = null;

  function pad2num(value) { return String(Number(value) || 0).padStart(2, '0'); }

  function dayLabel(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return pad2num(d.getMonth() + 1) + ' / ' + pad2num(d.getDate());
  }

  function logTime(record) {
    var date = String(record.date || '');
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (m) return m[2] + ' / ' + m[3];
    return dayLabel(Date.parse(date));
  }

  function recentItems() {
    var items = [];
    (recentLogs || []).forEach(function (log) {
      var photos = Array.isArray(log.photos) ? log.photos : [];
      items.push({
        page: 'logs',
        tag: log.kind || '说说',
        time: logTime(log),
        title: log.title || '无标题',
        img: photos[0] || '',
        sortAt: Date.parse(log.date) || 0,
      });
    });
    reviews.forEach(function (review) {
      items.push({
        page: 'reviews',
        tag: '测评',
        time: dayLabel(Date.parse(review.createdAt || review.updatedAt || '')),
        title: (review.title || '测评') + (review.score ? ' · ' + Number(review.score).toFixed(1) : ''),
        img: review.cover || '',
        sortAt: Date.parse(review.createdAt || review.updatedAt || '') || 0,
      });
    });
    items.sort(function (a, b) { return b.sortAt - a.sortAt; });
    return items.slice(0, 3);
  }

  async function loadRecentLogs() {
    if (recentLogs) return recentLogs;
    try {
      var response = await fetch('public/logs.json?v=' + Date.now(), { cache: 'no-store' });
      if (response.ok) {
        var data = await response.json();
        recentLogs = Array.isArray(data.logs) ? data.logs : [];
      }
    } catch (error) {
      console.warn('public/logs.json 读取失败', error);
    }
    recentLogs = recentLogs || [];
    return recentLogs;
  }

  function renderRecent() {
    var wrap = document.getElementById('recentList');
    if (!wrap) return;
    var items = recentItems();
    wrap.innerHTML = '';
    if (!items.length) {
      var blank = document.createElement('div');
      blank.className = 'recent-item is-empty';
      blank.innerHTML = '<span><div class="ri-meta"><span>动态</span><span></span></div><div class="ri-title">还没有动态</div></span>';
      wrap.appendChild(blank);
      return;
    }
    items.forEach(function (item) {
      var a = document.createElement('a');
      a.className = 'recent-item';
      a.href = '#' + item.page;
      a.setAttribute('data-page-link', item.page);
      if (!item.img) a.classList.add('is-plain');
      var img = item.img ? '<img class="recent-bg" src="' + esc(coverUrl(item.img)) + '" alt="">' : '';
      a.innerHTML = img + '<span class="ri-arrow">↗</span><span><div class="ri-meta"><span>' + esc(item.tag) + '</span><span>' + esc(item.time) + '</span></div><div class="ri-title">' + esc(item.title) + '</div></span>';
      wrap.appendChild(a);
    });
  }

  function renderAbout() {
    var brandAvatar = document.getElementById('brandAvatarImg');
    var heroBg = document.getElementById('heroBg');
    var aboutAvatar = document.getElementById('aboutAvatar');
    var aboutCover = document.getElementById('aboutCover');
    if (aboutAvatar && brandAvatar && brandAvatar.getAttribute('src')) aboutAvatar.src = brandAvatar.getAttribute('src');
    if (aboutCover && heroBg && heroBg.getAttribute('src')) aboutCover.src = heroBg.getAttribute('src');
  }

  /* 卡片渲染时字体/布局还没稳定，量出来的高度不可信，所以晚一帧再决定要不要显示「展开全文」 */
  function syncReviewToggles() {
    var list = document.getElementById('reviewList');
    if (!list) return;
    /* 页面还没显示（display:none）时量不到真实高度，先跳过，等它可见再算 */
    if (!list.clientHeight) return;
    Array.prototype.forEach.call(list.querySelectorAll('.review-card'), function (card) {
      var text = card.querySelector('.review-text');
      var toggle = card.querySelector('.review-toggle');
      if (!text || !toggle) return;
      if (text.classList.contains('is-open')) { toggle.style.display = ''; return; }
      if (!text.clientHeight) return;
      var clamped = text.scrollHeight > text.clientHeight + 2;
      toggle.style.display = clamped ? '' : 'none';
    });
  }

  /* reviewList 一旦可见 / 宽度变化就重算一次，避免「首次打开没有展开按钮、刷新才有」 */
  var reviewResizeObserver = null;
  var reviewVisibleObserver = null;

  function watchReviews() {
    var list = document.getElementById('reviewList');
    if (!list) return;
    if (typeof ResizeObserver === 'function') {
      if (!reviewResizeObserver) {
        reviewResizeObserver = new ResizeObserver(function () { syncReviewToggles(); });
      }
      reviewResizeObserver.observe(list);
      Array.prototype.forEach.call(list.querySelectorAll('.review-text'), function (node) {
        reviewResizeObserver.observe(node);
      });
    }
    if (typeof IntersectionObserver === 'function' && !reviewVisibleObserver) {
      reviewVisibleObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { if (entry.isIntersecting) syncReviewToggles(); });
      });
    }
    if (reviewVisibleObserver) reviewVisibleObserver.observe(list);
  }

  function scheduleReviewToggles() {
    syncReviewToggles();
    watchdogReviewToggles();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { syncReviewToggles(); });
    }
  }

  function watchdogReviewToggles() {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      syncReviewToggles();
      var list = document.getElementById('reviewList');
      var pending = list && Array.prototype.some.call(list.querySelectorAll('.review-card'), function (card) {
        var text = card.querySelector('.review-text');
        var toggle = card.querySelector('.review-toggle');
        return text && toggle && !text.clientHeight;
      });
      if (!pending || tries > 20) clearInterval(timer);
    }, 250);
  }

  function closeModal(id) { var m = document.getElementById(id); if (m) m.hidden = true; }

  function bind() {
    var filters = document.getElementById('reviewFilters');
    if (filters) filters.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-review-filter]');
      if (!btn) return;
      renderReviews(btn.getAttribute('data-review-filter'));
    });

    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeModal(b.getAttribute('data-close')); });
    });

    var reviewCoverUrl = document.getElementById('reviewCover');
    var reviewCoverPreview = document.getElementById('reviewCoverPreview');

    function renderReviewCoverPreview() {
      if (!reviewCoverPreview) return;
      var value = reviewCoverUrl ? reviewCoverUrl.value.trim() : '';
      reviewCoverPreview.innerHTML = '';
      if (!value) {
        var hint = document.createElement('span');
        hint.className = 'cover-edit-empty';
        hint.textContent = '还没有封面';
        reviewCoverPreview.appendChild(hint);
        return;
      }
      var img = document.createElement('img');
      img.src = value;
      img.alt = '';
      img.onerror = function () {
        reviewCoverPreview.innerHTML = '<span class="cover-edit-empty">图片读不出来</span>';
      };
      reviewCoverPreview.appendChild(img);
    }

    function openReviewModal() {
      var m = document.getElementById('reviewModal');
      if (!m) return;
      m.hidden = false;
      renderReviewCoverPreview();
      var titleEl = document.getElementById('reviewTitle');
      if (titleEl) titleEl.focus();
    }

    var addReviewBtn = document.getElementById('addReviewBtn');
    if (addReviewBtn) addReviewBtn.addEventListener('click', openReviewModal);

    /* 封面上传：压缩后直接进 public/reviews/，再把路径填回封面输入框 */
    var reviewCoverBtn = document.getElementById('reviewCoverBtn');
    var reviewCoverInput = document.getElementById('reviewCoverInput');
    if (reviewCoverBtn && reviewCoverInput) {
      reviewCoverBtn.addEventListener('click', function () { reviewCoverInput.click(); });
      reviewCoverInput.addEventListener('change', async function () {
        var file = reviewCoverInput.files && reviewCoverInput.files[0];
        reviewCoverInput.value = '';
        if (!file) return;
        if (!window.AtlasAssets || !window.AtlasAssets.hasRepo()) {
          toast('封面要存进仓库才能被访客看到：请先在「发布设置」里保存 GitHub Token', 'error', 6500);
          return;
        }
        reviewCoverBtn.disabled = true;
        var oldText = reviewCoverBtn.textContent;
        reviewCoverBtn.textContent = '上传中…';
        try {
          var prepared = await window.AtlasAssets.compress(file);
          var ext = (prepared.type || '').indexOf('webp') >= 0 ? '.webp' : '.jpg';
          var path = 'public/reviews/cover-' + Date.now() + ext;
          await window.AtlasAssets.upload(path, prepared.blob, 'Upload review cover');
          if (reviewCoverUrl) reviewCoverUrl.value = path;
          renderReviewCoverPreview();
          toast('封面已上传，保存测评后访客可见');
        } catch (error) {
          toast(error.message || '封面上传失败', 'error', 5500);
        } finally {
          reviewCoverBtn.disabled = false;
          reviewCoverBtn.textContent = oldText;
        }
      });
    }
    if (reviewCoverUrl) reviewCoverUrl.addEventListener('input', renderReviewCoverPreview);

    var reviewForm = document.getElementById('reviewForm');
    if (reviewForm) reviewForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var config = githubConfig();
      var title = document.getElementById('reviewTitle').value.trim();
      var text = document.getElementById('reviewText').value.trim();
      if (!title || !text) return;
      if (!config) {
        toast('写测评需要先在「发布设置」里保存 GitHub Token，保存后才是公开数据', 'error', 6000);
        return;
      }
      var cat = document.getElementById('reviewCat').value;
      var submit = reviewForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        var entry = await window.GitHubStore.saveReview(config, {
          title: title,
          category: cat,
          categoryLabel: CATEGORY_LABELS[cat] || '测评',
          sub: (document.getElementById('reviewSub') || {}).value && document.getElementById('reviewSub').value.trim()
            ? document.getElementById('reviewSub').value.trim()
            : (CATEGORY_LABELS[cat] || '测评') + ' · 新测评',
          score: Number(document.getElementById('reviewScore').value) || 8,
          cover: document.getElementById('reviewCover').value.trim() || 'public/gallery/Myethos 流萤 春日手信.jpg',
          text: text,
          images: 0,
          createdAt: Date.now()
        });
        reviews = [entry].concat(reviews.filter(function (item) { return item.id !== entry.id; }));
        reviewSource = 'github';
        renderReviews(currentFilter);
        closeModal('reviewModal');
        reviewForm.reset();
        renderReviewCoverPreview();
        toast('测评已写入 public/reviews.json，约 1 分钟后访客可见');
      } catch (error) {
        toast(error.message || '保存失败', 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
    });

  }

  document.addEventListener('atlas:images', function () {
    renderAbout();
  });

  document.addEventListener('DOMContentLoaded', async function () {
    renderAbout();
    bind();
    renderReviews('all');

    var loaded = await loadReviews();
    reviews = loaded.rows;
    reviewSource = loaded.source;
    renderReviews(currentFilter);

    await loadRecentLogs();
    renderRecent();
  });
})();
