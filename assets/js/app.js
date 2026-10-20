/* ==========================================================================
   Personal Library — application logic
   Local data lives in IndexedDB; published files live in the GitHub repo.
   ========================================================================== */
(function () {
  'use strict';

  var DB = window.LibraryDB;
  var DEFAULT_AVATAR = 'assets/img/avatar-default.jpg';
  var DEFAULT_COVER = 'assets/img/cover-default.jpg';
  // 前端口令只能挡住普通访客；文件仍在公开仓库中，不能当作真正的加密。
  var DOWNLOAD_PASSWORD = 'KasuganoSora';

  var DEFAULT_PROFILE = {
    siteTitle: '我的资料库',
    name: '你的名字',
    tagline: '工作文件、喜欢的图片和循环播放的歌，都收在这里。',
    headline: '独立创作者 / 记录者',
    status: '开放交流',
    bio: '这里是我的个人主页。我把工作用的文件、喜欢的图片和常听的音乐整理在一起，随时更换，随时删除。',
    location: '中国',
    email: '',
    tags: ['工作资料', '摄影', '音乐'],
    github: '',
    bilibili: '',
    website: '',
    avatarMediaId: '',
    avatarUrl: '',
    coverMediaId: '',
    coverUrl: ''
  };

  var state = {
    settings: null,
    files: [],
    photos: [],
    tracks: [],
    query: '',
    storageReady: false,
    trackIndex: -1,
    repeat: 'all',
    galleryIndex: 0,
    pendingAvatar: null,
    avatarRemoved: false,
    linkType: 'file',
    confirmAction: null,
    lastFocused: null,
    audioFailed: false,
    github: window.GitHubStore ? window.GitHubStore.load() : null,
    uploading: false,
    publicSite: null,
    pendingDownload: null,
    autoplayAttempted: false,
    autoplayGestureHandler: null
  };

  var urlCache = new Map();
  var dom = {};

  /* ----------------------------------------------------------------------
     Small utilities
     ---------------------------------------------------------------------- */
  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value == null ? '' : String(value);
  }

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value == null || value === false) return;
        if (key === 'class') {
          node.className = value;
        } else if (key === 'dataset') {
          Object.keys(value).forEach(function (name) { node.dataset[name] = value[name]; });
        } else if (key.charAt(0) === 'o' && key.charAt(1) === 'n' && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) {
          node.setAttribute(key, '');
        } else {
          node.setAttribute(key, value);
        }
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      appendChild(node, arguments[i]);
    }
    return node;
  }

  function appendChild(node, child) {
    if (child == null || child === false || child === '') return;
    if (Array.isArray(child)) {
      child.forEach(function (item) { appendChild(node, item); });
      return;
    }
    node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  function icon(name, className) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', className || 'icon');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return 'm_' + crypto.randomUUID();
    return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var index = -1;
    do {
      value /= 1024;
      index++;
    } while (value >= 1024 && index < units.length - 1);
    return (value >= 10 ? Math.round(value) : value.toFixed(1)) + ' ' + units[index];
  }

  function formatDate(timestamp) {
    if (!timestamp) return '';
    try {
      return new Date(timestamp).toLocaleDateString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit'
      });
    } catch (err) {
      return '';
    }
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    var total = Math.floor(seconds);
    var minutes = Math.floor(total / 60);
    var rest = total % 60;
    if (minutes >= 60) {
      var hours = Math.floor(minutes / 60);
      minutes = minutes % 60;
      return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
    }
    return minutes + ':' + String(rest).padStart(2, '0');
  }

  function normalizeUrl(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (/^(https?:|mailto:)/i.test(text)) return text;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'mailto:' + text;
    return 'https://' + text.replace(/^\/+/, '');
  }

  function hostLabel(value) {
    try {
      return new URL(normalizeUrl(value)).hostname.replace(/^www\./, '');
    } catch (err) {
      return '个人网站';
    }
  }

  function extOf(name) {
    var match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  var FILE_STYLES = {
    pdf: ['PDF', '#ff7a8a'],
    doc: ['DOC', '#6ea8fe'], docx: ['DOC', '#6ea8fe'],
    xls: ['XLS', '#4ade80'], xlsx: ['XLS', '#4ade80'], csv: ['CSV', '#4ade80'],
    ppt: ['PPT', '#fb923c'], pptx: ['PPT', '#fb923c'],
    zip: ['ZIP', '#fbbf24'], rar: ['RAR', '#fbbf24'], '7z': ['7Z', '#fbbf24'], gz: ['GZ', '#fbbf24'],
    png: ['PNG', '#c084fc'], jpg: ['JPG', '#c084fc'], jpeg: ['JPG', '#c084fc'],
    gif: ['GIF', '#c084fc'], webp: ['WEBP', '#c084fc'], svg: ['SVG', '#c084fc'],
    mp3: ['MP3', '#22d3ee'], wav: ['WAV', '#22d3ee'], flac: ['FLAC', '#22d3ee'], m4a: ['M4A', '#22d3ee'],
    mp4: ['MP4', '#f472b6'], mov: ['MOV', '#f472b6'], mkv: ['MKV', '#f472b6'],
    txt: ['TXT', '#94a3b8'], md: ['MD', '#94a3b8'], rtf: ['RTF', '#94a3b8'],
    js: ['JS', '#a3e635'], ts: ['TS', '#a3e635'], py: ['PY', '#a3e635'],
    html: ['HTML', '#fb923c'], css: ['CSS', '#38bdf8'], json: ['JSON', '#facc15']
  };

  function fileInfo(record) {
    var ext = extOf(record.name);
    var style = FILE_STYLES[ext];
    var image = (record.mime || '').indexOf('image/') === 0 ||
      /^(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(ext);
    if (!style) {
      style = [ext ? ext.slice(0, 4).toUpperCase() : 'FILE', '#94a3b8'];
    }
    return { label: style[0], color: style[1], image: image, ext: ext };
  }

  function mediaUrl(record) {
    if (!record) return '';
    if (record.url) return record.url;
    if (!record.blob) return '';
    if (!urlCache.has(record.id)) {
      urlCache.set(record.id, URL.createObjectURL(record.blob));
    }
    return urlCache.get(record.id);
  }

  function publicUrl(entry) {
    if (!entry) return '';
    if (entry.url && /^https?:\/\//i.test(entry.url)) return entry.url;
    var path = entry.path || entry.url || ('public/files/' + entry.name);
    return String(path).split('/').map(encodeURIComponent).join('/');
  }

  function normalizePublicEntries(list) {
    return (Array.isArray(list) ? list : []).filter(Boolean).map(function (entry, index) {
      var external = !!entry.external || /^https?:\/\//i.test(String(entry.url || ''));
      return {
        id: entry.path || ('public_' + index),
        kind: 'file',
        name: entry.name || '未命名文件',
        mime: entry.mime || '',
        size: entry.size || 0,
        createdAt: entry.createdAt || 0,
        url: external ? entry.url : publicUrl(entry),
        path: entry.path || '',
        sha: entry.sha || '',
        public: !external,
        external: external
      };
    }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  async function fetchPublicSite() {
    try {
      var response = await fetch('public/site.json?v=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  async function loadPublicFiles() {
    if (state.github && window.GitHubStore) {
      try {
        var manifest = await window.GitHubStore.readManifest(state.github);
        return normalizePublicEntries(manifest.files);
      } catch (error) {
        console.warn('GitHub 清单读取失败，回退到 Pages 清单', error);
      }
    }
    try {
      var response = await fetch('public/files.json?v=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) return [];
      var data = await response.json();
      return normalizePublicEntries(data.files);
    } catch (error) {
      return [];
    }
  }

  function normalizePublicTracks(list) {
    return (Array.isArray(list) ? list : []).filter(Boolean).map(function (entry, index) {
      var path = entry.path || '';
      var rawUrl = entry.url || '';
      var url = /^https?:\/\//i.test(rawUrl) ? rawUrl : publicUrl({ path: path || rawUrl });
      return {
        id: entry.id || ('pub_' + index + '_' + (entry.createdAt || Date.now())),
        kind: 'audio',
        title: entry.title || entry.name || '公开音乐',
        artist: entry.artist || '公开音乐',
        mime: entry.mime || 'audio/mpeg',
        size: entry.size || 0,
        duration: entry.duration || 0,
        createdAt: entry.createdAt || 0,
        public: true,
        publicPath: path,
        url: url
      };
    });
  }

  async function loadPublicTracks() {
    if (state.github && window.GitHubStore) {
      try {
        var manifest = await window.GitHubStore.readMusic(state.github);
        return normalizePublicTracks(manifest.tracks);
      } catch (error) {
        console.warn('GitHub 音乐清单读取失败，回退到 Pages 清单', error);
      }
    }
    try {
      var response = await fetch('public/music.json?v=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) return [];
      var data = await response.json();
      return normalizePublicTracks(data.tracks);
    } catch (error) {
      return [];
    }
  }

  function mergeTracks(localTracks, publicTracks) {
    var local = Array.isArray(localTracks) ? localTracks : [];
    var seen = {};
    local.forEach(function (track) {
      if (track.publicPath) seen[track.publicPath] = true;
    });
    var extra = (Array.isArray(publicTracks) ? publicTracks : []).filter(function (track) {
      if (track.publicPath && seen[track.publicPath]) return false;
      return !local.some(function (item) {
        return item.title === track.title && (item.size || 0) === (track.size || 0);
      });
    });
    return local.concat(extra).sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
  }

  function revokeMedia(id) {
    if (urlCache.has(id)) {
      URL.revokeObjectURL(urlCache.get(id));
      urlCache.delete(id);
    }
  }

  function setImage(img, src, fallback) {
    if (!img) return;
    if (img.dataset.currentSrc === src) return;
    img.dataset.currentSrc = src;
    img.onerror = function () {
      img.onerror = null;
      if (fallback && img.getAttribute('src') !== fallback) {
        img.dataset.currentSrc = fallback;
        img.src = fallback;
      }
    };
    img.src = src || fallback;
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsDataURL(blob);
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function readAudioDuration(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var audio = new Audio();
      var done = false;
      function finish(value) {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        resolve(value || 0);
      }
      audio.preload = 'metadata';
      audio.onloadedmetadata = function () {
        finish(isFinite(audio.duration) ? audio.duration : 0);
      };
      audio.onerror = function () { finish(0); };
      audio.src = url;
      setTimeout(function () { finish(0); }, 6000);
    });
  }

  function parseTrackName(filename) {
    var name = String(filename || '未命名音频').replace(/\.[a-z0-9]+$/i, '');
    var parts = name.split(/\s+-\s+/);
    if (parts.length >= 2) {
      return { artist: parts[0].trim() || '未知艺术家', title: parts.slice(1).join(' - ').trim() };
    }
    return { artist: '本地音乐', title: name.trim() || '未命名音频' };
  }

  /* ----------------------------------------------------------------------
     Toasts
     ---------------------------------------------------------------------- */
  function toast(message, type, duration) {
    if (!dom.toasts) return;
    var kind = type || 'success';
    var iconName = kind === 'error' ? 'x' : kind === 'info' ? 'sparkle' : 'check';
    var node = h('div', { class: 'toast' + (kind === 'error' ? ' is-error' : kind === 'info' ? ' is-info' : '') },
      icon(iconName),
      h('span', null, message)
    );
    dom.toasts.appendChild(node);
    while (dom.toasts.children.length > 4) {
      dom.toasts.firstElementChild.remove();
    }
    setTimeout(function () {
      node.classList.add('is-leaving');
      setTimeout(function () { node.remove(); }, 300);
    }, duration || 3200);
  }

  function reportError(error) {
    console.error(error);
    toast((error && error.message) || '操作失败，请重试', 'error', 5000);
  }

  function guard(fn) {
    return function (event) {
      try {
        var result = fn(event);
        if (result && typeof result.catch === 'function') result.catch(reportError);
      } catch (error) {
        reportError(error);
      }
    };
  }

  /* ----------------------------------------------------------------------
     Storage bootstrap
     ---------------------------------------------------------------------- */
  function normalizeSettings(raw) {
    var profile = Object.assign({}, DEFAULT_PROFILE, (raw && raw.profile) || {});
    if (!Array.isArray(profile.tags)) {
      profile.tags = String(profile.tags || '').split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
    }
    profile.tags = profile.tags.slice(0, 8);
    return {
      profile: profile,
      theme: raw && raw.theme === 'dark' ? 'dark' : 'light',
      noticeDismissed: !!(raw && raw.noticeDismissed)
    };
  }

  async function loadData() {
    var raw = null;
    try {
      await DB.init();
      raw = await DB.getSettings();
      state.storageReady = true;
    } catch (error) {
      state.storageReady = false;
      console.error(error);
      setTimeout(function () {
        toast('浏览器本地存储不可用，本机设置与音乐将无法保存', 'error', 7000);
      }, 600);
    }

    var publicSite = await fetchPublicSite();
    state.publicSite = publicSite;

    if (!raw && publicSite && publicSite.profile) {
      state.settings = normalizeSettings({ profile: publicSite.profile, theme: publicSite.theme });
      if (publicSite.avatar) state.settings.profile.avatarUrl = publicSite.avatar;
      if (publicSite.cover) state.settings.profile.coverUrl = publicSite.cover;
    } else {
      state.settings = normalizeSettings(raw);
    }

    var storedTheme = null;
    try { storedTheme = localStorage.getItem('atlas-theme'); } catch (err) { /* noop */ }
    if (storedTheme && !raw) {
      state.settings.theme = storedTheme === 'dark' ? 'dark' : 'light';
    }
    applyTheme(state.settings.theme, false);

    state.files = await loadPublicFiles();
    state.photos = [];
    var publicTracks = await loadPublicTracks();

    if (!state.storageReady) {
      state.tracks = publicTracks;
      return;
    }

    try {
      var tracks = await DB.listMedia('audio');
      state.tracks = mergeTracks(tracks, publicTracks);
    } catch (error) {
      state.tracks = publicTracks;
      reportError(error);
    }
  }

  async function persistSettings() {
    if (!state.storageReady) return;
    try {
      await DB.saveSettings(state.settings);
    } catch (error) {
      reportError(error);
    }
  }

  /* ----------------------------------------------------------------------
     Rendering — profile
     ---------------------------------------------------------------------- */
  async function resolveImage(mediaId, externalUrl, fallback) {
    if (mediaId && state.storageReady) {
      try {
        var record = await DB.getMedia(mediaId);
        if (record) return mediaUrl(record);
      } catch (error) {
        console.warn(error);
      }
    }
    return externalUrl || fallback;
  }

  async function updateImages() {
    var profile = state.settings.profile;
    var avatar = await resolveImage(profile.avatarMediaId, profile.avatarUrl, DEFAULT_AVATAR);
    var cover = await resolveImage(profile.coverMediaId, profile.coverUrl, DEFAULT_COVER);
    setImage(dom.brandAvatarImg, avatar, DEFAULT_AVATAR);
    setImage(dom.profileAvatar, avatar, DEFAULT_AVATAR);
    setImage(dom.avatarPreview, avatar, DEFAULT_AVATAR);
    setImage(dom.heroBg, cover, DEFAULT_COVER);
    if (dom.resetCoverBtn) {
      dom.resetCoverBtn.hidden = !(profile.coverMediaId || profile.coverUrl);
    }
  }

  function renderProfile() {
    var profile = state.settings.profile;
    var year = String(new Date().getFullYear());

    setText('brandName', profile.name);
    setText('heroTitle', profile.siteTitle || '我的资料库');
    setText('heroSubtitle', profile.tagline);
    setText('heroStatus', profile.status || '开放交流');
    setText('profileName', profile.name);
    setText('profileHeadline', profile.headline);
    setText('profileBio', profile.bio);
    setText('footerName', profile.name);
    setText('footerName2', profile.name);
    setText('footerYear', year);
    setText('heroYear', year);

    var heroTags = document.getElementById('heroTags');
    if (heroTags) {
      heroTags.innerHTML = '';
      var tags = profile.tags.slice(0, 5);
      tags.forEach(function (tag) { heroTags.appendChild(h('span', { class: 'hero-tag' }, tag)); });
      heroTags.hidden = tags.length === 0;
    }

    var profileTags = document.getElementById('profileTags');
    if (profileTags) {
      profileTags.innerHTML = '';
      profile.tags.forEach(function (tag) { profileTags.appendChild(h('span', { class: 'tag' }, tag)); });
      profileTags.hidden = profile.tags.length === 0;
    }

    renderLinks(profile);
  }

  function renderLinks(profile) {
    var container = document.getElementById('profileLinks');
    if (!container) return;
    container.innerHTML = '';

    var links = [];
    if (profile.github) links.push({ icon: 'github', label: 'GitHub', href: normalizeUrl(profile.github) });
    if (profile.bilibili) links.push({ icon: 'bilibili', label: 'Bilibili', href: normalizeUrl(profile.bilibili) });
    if (profile.website) links.push({ icon: 'globe', label: hostLabel(profile.website), href: normalizeUrl(profile.website) });
    if (profile.email) links.push({ icon: 'mail', label: profile.email, href: 'mailto:' + profile.email });

    links.forEach(function (item) {
      container.appendChild(
        h('a', {
          class: 'profile-link', href: item.href,
          target: item.href.indexOf('mailto:') === 0 ? null : '_blank',
          rel: 'noopener noreferrer', title: item.label
        }, icon(item.icon), h('span', null, item.label))
      );
    });

    if (profile.location) {
      container.appendChild(
        h('span', { class: 'profile-link', title: profile.location },
          icon('pin'), h('span', null, profile.location))
      );
    }

    container.hidden = container.children.length === 0;
  }

  function renderCounts() {
    var counts = {
      files: state.files.length,
      photos: state.photos.length,
      tracks: state.tracks.length
    };
    setText('heroFileCount', counts.files);
    setText('heroPhotoCount', counts.photos);
    setText('heroTrackCount', counts.tracks);
    setText('statFiles', counts.files);
    setText('statPhotos', counts.photos);
    setText('statTracks', counts.tracks);
    setText('fileCount', counts.files);
    setText('galleryCount', counts.photos);
    setText('trackCount', counts.tracks);
    setText('profileAside', (state.github ? 'GitHub 公开库' : '公开资料库') + ' · ' + (counts.files + counts.tracks) + ' 项内容');
  }

  /* ----------------------------------------------------------------------
     Rendering — gallery
     ---------------------------------------------------------------------- */
  function renderGallery() {
    var photos = state.photos;
    if (!dom.galleryGrid) return;

    dom.galleryGrid.innerHTML = '';
    dom.galleryGrid.hidden = photos.length === 0;
    dom.galleryEmpty.hidden = photos.length !== 0;

    photos.forEach(function (record, index) {
      var className = 'photo-card';
      if (photos.length >= 4 && index === 0) className += ' is-feature';
      if (photos.length >= 7 && index === 5) className += ' is-wide';

      var img = h('img', {
        src: mediaUrl(record),
        alt: record.caption || record.name || '图片',
        loading: 'lazy',
        decoding: 'async',
        referrerpolicy: 'no-referrer'
      });
      img.addEventListener('error', function () {
        figure.classList.add('is-broken');
        img.remove();
      });

      var figure = h('figure', {
        class: className,
        tabindex: '0',
        role: 'button',
        'aria-label': '查看图片：' + (record.caption || record.name || ''),
        dataset: { id: record.id }
      }, img);

      if (record.caption) {
        figure.appendChild(h('figcaption', null, record.caption));
      }

      var actions = h('div', { class: 'photo-actions' },
        h('button', {
          class: 'icon-btn', type: 'button', title: '设为封面', 'aria-label': '设为封面',
          onclick: guard(function (event) {
            event.stopPropagation();
            return setCoverFromRecord(record);
          })
        }, icon('image')),
        h('button', {
          class: 'icon-btn', type: 'button', title: '删除图片', 'aria-label': '删除图片',
          onclick: guard(function (event) {
            event.stopPropagation();
            return confirmDeletePhoto(record);
          })
        }, icon('trash'))
      );
      figure.appendChild(actions);
      dom.galleryGrid.appendChild(figure);
    });

    dom.galleryGrid.onclick = function (event) {
      var figure = event.target.closest('.photo-card');
      if (!figure || event.target.closest('button')) return;
      var index = state.photos.findIndex(function (item) { return item.id === figure.dataset.id; });
      if (index >= 0) openLightbox(index);
    };

    dom.galleryGrid.onkeydown = function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var figure = event.target.closest('.photo-card');
      if (!figure) return;
      event.preventDefault();
      var index = state.photos.findIndex(function (item) { return item.id === figure.dataset.id; });
      if (index >= 0) openLightbox(index);
    };
  }

  function confirmDeletePhoto(record) {
    askConfirm({
      title: '删除这张图片？',
      message: '「' + (record.caption || record.name || '图片') + '」将从画廊中移除，此操作不可撤销。',
      okText: '删除图片',
      onConfirm: async function () {
        await DB.deleteMedia(record.id);
        revokeMedia(record.id);
        state.photos = state.photos.filter(function (item) { return item.id !== record.id; });
        if (record.id === state.settings.profile.coverMediaId) {
          state.settings.profile.coverMediaId = '';
          await persistSettings();
        }
        renderGallery();
        renderCounts();
        updateImages();
        updateStorage();
        if (!dom.lightbox.hidden) {
          if (state.photos.length === 0) closeLightbox();
          else {
            state.galleryIndex = clamp(state.galleryIndex, 0, state.photos.length - 1);
            renderLightbox();
          }
        }
        toast('图片已删除');
      }
    });
  }

  async function setCoverFromRecord(record) {
    var profile = state.settings.profile;
    revokeMedia('cover');
    if (record.url) {
      profile.coverMediaId = '';
      profile.coverUrl = record.url;
    } else {
      profile.coverMediaId = record.id;
      profile.coverUrl = '';
    }
    await persistSettings();
    await updateImages();
    toast('已设为首页封面');
  }

  /* ----------------------------------------------------------------------
     Rendering — files
     ---------------------------------------------------------------------- */
  function makeThumb(record) {
    var info = fileInfo(record);
    var thumb = h('div', { class: 'file-thumb' });
    thumb.style.setProperty('--tint', info.color);

    if (info.image) {
      var img = h('img', {
        src: mediaUrl(record), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer'
      });
      img.addEventListener('error', function () {
        img.remove();
        thumb.textContent = info.label;
      });
      thumb.appendChild(img);
    } else {
      thumb.textContent = info.label;
    }
    return thumb;
  }

  function highlightedName(name, query) {
    if (!query) return document.createTextNode(name);
    var lowerName = name.toLowerCase();
    var lowerQuery = query.toLowerCase();
    var fragment = document.createDocumentFragment();
    var cursor = 0;

    while (cursor < name.length) {
      var found = lowerName.indexOf(lowerQuery, cursor);
      if (found === -1) {
        fragment.appendChild(document.createTextNode(name.slice(cursor)));
        break;
      }
      if (found > cursor) fragment.appendChild(document.createTextNode(name.slice(cursor, found)));
      var mark = document.createElement('mark');
      mark.textContent = name.slice(found, found + query.length);
      fragment.appendChild(mark);
      cursor = found + query.length;
    }
    return fragment;
  }

  function renderFiles() {
    document.body.classList.toggle('is-visitor', !state.github);
    var query = state.query.trim().toLowerCase();
    var filtered = state.files.filter(function (record) {
      return !query || String(record.name || '').toLowerCase().indexOf(query) !== -1;
    });

    dom.fileList.innerHTML = '';
    dom.fileList.hidden = filtered.length === 0;
    dom.filesEmpty.hidden = state.files.length !== 0;
    dom.dropzone.hidden = state.files.length === 0;
    dom.fileNoResults.hidden = !(state.files.length > 0 && filtered.length === 0);
    setText('fileCount', state.files.length);

    filtered.forEach(function (record) {
      var info = fileInfo(record);
      var name = limitName(record.name || '未命名文件');

      var row = h('div', { class: 'file-row', dataset: { id: record.id } },
        makeThumb(record),
        h('div', { class: 'file-info' },
          h('div', { class: 'file-name', title: record.name || '' }, highlightedName(name, state.query.trim())),
          h('div', { class: 'file-meta' },
            h('span', { class: 'tag-mini' }, record.external ? 'LINK' : record.public ? 'GITHUB' : info.label),
            h('span', null, record.external ? '外部链接' : record.public ? '公开下载' : formatBytes(record.size)),
            h('span', { class: 'dot-sep' }),
            h('span', null, formatDate(record.createdAt))
          )
        ),
        h('div', { class: 'file-actions' },
          h('button', {
            class: 'icon-btn', type: 'button', title: '下载', 'aria-label': '下载文件',
            onclick: guard(function () { requestDownload(record); })
          }, icon('download')),
          state.github ? h('button', {
            class: 'icon-btn is-danger', type: 'button', title: '删除', 'aria-label': '删除文件',
            onclick: guard(function () { return confirmDeleteFile(record); })
          }, icon('trash')) : null
        )
      );
      dom.fileList.appendChild(row);
    });
  }

  function limitName(name) {
    return String(name).length > 120 ? String(name).slice(0, 117) + '…' : String(name);
  }

  function downloadUnlocked() {
    try { return sessionStorage.getItem('atlas-download-unlocked') === '1'; } catch (err) { return false; }
  }

  function requestDownload(record) {
    if (!record) return;
    if (downloadUnlocked()) {
      performDownload(record);
      return;
    }
    state.pendingDownload = record;
    openPasswordModal();
  }

  function performDownload(record) {
    if (record.external) {
      window.open(record.url, '_blank', 'noopener');
      return;
    }
    if (record.public) {
      var link = document.createElement('a');
      link.href = record.url;
      link.download = record.name || 'download';
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    var url = mediaUrl(record);
    if (!url) {
      toast('文件数据丢失，无法下载', 'error');
      return;
    }
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = record.name || 'download';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function openPasswordModal() {
    var input = document.getElementById('downloadPassword');
    var error = document.getElementById('passwordError');
    if (input) input.value = '';
    if (error) error.hidden = true;
    openModal('passwordModal', '#downloadPassword');
  }

  function submitDownloadPassword(event) {
    event.preventDefault();
    var input = document.getElementById('downloadPassword');
    var error = document.getElementById('passwordError');
    var value = input ? input.value : '';
    if (value !== DOWNLOAD_PASSWORD) {
      if (error) error.hidden = false;
      if (input) { input.value = ''; input.focus(); }
      return;
    }
    try { sessionStorage.setItem('atlas-download-unlocked', '1'); } catch (err) { /* noop */ }
    var record = state.pendingDownload;
    state.pendingDownload = null;
    closeModal('passwordModal');
    toast('密码正确，开始下载');
    // 保持用户手势：外部链接的 window.open 若放进 setTimeout 会被弹窗拦截。
    if (record) performDownload(record);
  }

  function confirmDeleteFile(record) {
    if (record.public || record.external) {
      if (!state.github) {
        toast('请先在发布设置中连接 GitHub，才能删除公开资料', 'info', 4200);
        openPublishModal();
        return;
      }
      askConfirm({
        title: '从 GitHub 删除这份资料？',
        message: '「' + (record.name || '文件') + '」会从仓库和公开清单中移除，访客将无法再下载。',
        okText: '删除资料',
        onConfirm: async function () {
          await window.GitHubStore.removeFile(state.github, record);
          state.files = await loadPublicFiles();
          renderFiles();
          renderCounts();
          updateStorage();
          toast('已从 GitHub 删除，Pages 约 1 分钟后更新', 'success', 5200);
        }
      });
      return;
    }

    askConfirm({
      title: '删除这份资料？',
      message: '「' + (record.name || '文件') + '」将从资料库中永久删除，此操作不可撤销。',
      okText: '删除资料',
      onConfirm: async function () {
        await DB.deleteMedia(record.id);
        revokeMedia(record.id);
        state.files = state.files.filter(function (item) { return item.id !== record.id; });
        renderFiles();
        renderCounts();
        updateStorage();
        toast('资料已删除');
      }
    });
  }

  /* ----------------------------------------------------------------------
     Uploads
     ---------------------------------------------------------------------- */
  async function uploadPublicFiles(files) {
    if (!files.length || state.uploading) return;
    if (!state.github) {
      toast('请先配置 GitHub 仓库和 Token，才能公开上传', 'info', 4200);
      openPublishModal();
      return;
    }

    var limit = 25 * 1024 * 1024;
    var accepted = files.filter(function (file) { return file.size <= limit; });
    var rejected = files.length - accepted.length;
    if (!accepted.length) {
      toast('单个文件不能超过 25 MB，请压缩后再上传', 'error', 5200);
      return;
    }
    if (rejected) {
      toast(rejected + ' 个文件超过 25 MB，已跳过', 'error', 5200);
    }

    state.uploading = true;
    var buttons = [dom.addFilesBtn].concat(Array.prototype.slice.call(document.querySelectorAll('[data-action="add-files"]')));
    buttons.forEach(function (button) { button.disabled = true; });
    if (dom.filesPanel) dom.filesPanel.classList.add('is-uploading');
    toast('正在上传 ' + accepted.length + ' 份资料到 GitHub…', 'info', 8000);

    try {
      await window.GitHubStore.uploadFiles(state.github, accepted, function (done, total) {
        if (dom.filesPanel) dom.filesPanel.dataset.progress = done + '/' + total;
      });
      state.files = await loadPublicFiles();
      renderFiles();
      renderCounts();
      updateStorage();
      toast('已提交到 GitHub，Pages 约 1 分钟后更新', 'success', 6200);
    } catch (error) {
      reportError(error);
    } finally {
      state.uploading = false;
      buttons.forEach(function (button) { button.disabled = false; });
      if (dom.filesPanel) {
        dom.filesPanel.classList.remove('is-uploading');
        delete dom.filesPanel.dataset.progress;
      }
    }
  }

  async function addMediaFiles(fileList, kind) {
    if (kind !== 'file') return;
    return uploadPublicFiles(Array.prototype.slice.call(fileList || []));
  }

  async function addFilesFromInput(input, kind) {
    if (!input.files || !input.files.length) return;
    // 先复制成数组再清空 input：直接保存 FileList 引用会被 value='' 一起清空。
    var files = Array.prototype.slice.call(input.files);
    input.value = '';
    await addMediaFiles(files, kind);
  }

  function requestFilePicker() {
    if (!state.github) {
      toast('请先配置 GitHub 仓库和 Token，才能公开上传', 'info', 4200);
      openPublishModal();
      return;
    }
    dom.fileInput.click();
  }

  async function changeCover(file) {
    if (!file || !state.storageReady) return;
    var record = {
      id: 'cover',
      kind: 'asset',
      name: file.name,
      mime: file.type || '',
      size: file.size || 0,
      createdAt: Date.now(),
      blob: file
    };
    await DB.putMedia(record);
    revokeMedia('cover');
    state.settings.profile.coverMediaId = 'cover';
    state.settings.profile.coverUrl = '';
    await persistSettings();
    await updateImages();
    toast('封面已更新');
  }

  async function resetCover() {
    var profile = state.settings.profile;
    if (!profile.coverMediaId && !profile.coverUrl) return;
    profile.coverMediaId = '';
    profile.coverUrl = '';
    try { await DB.deleteMedia('cover'); } catch (error) { /* 记录可能已不存在 */ }
    revokeMedia('cover');
    await persistSettings();
    await updateImages();
    toast('已恢复默认封面');
  }

  /* ----------------------------------------------------------------------
     Links
     ---------------------------------------------------------------------- */
  function openLinkModal(type) {
    state.linkType = type;
    var isPhoto = type === 'photo';

    document.getElementById('linkModalTitle').textContent = isPhoto ? '通过链接添加图片' : '通过链接添加资料';
    document.getElementById('linkModalHint').textContent = isPhoto
      ? '填入公开可访问的图片地址，例如图床或仓库中的图片链接。'
      : '填入公开可访问的文件地址，适合放在 GitHub 仓库或网盘里的资料。';
    document.getElementById('linkCaptionField').hidden = !isPhoto;
    document.getElementById('linkUrl').value = '';
    document.getElementById('linkTitle').value = '';
    document.getElementById('linkCaption').value = '';
    document.getElementById('linkUrl').placeholder = isPhoto
      ? 'https://example.com/photo.jpg'
      : 'https://example.com/document.pdf';
    openModal('linkModal', '#linkUrl');
  }

  async function submitLink(event) {
    event.preventDefault();
    var url = normalizeUrl(document.getElementById('linkUrl').value);
    if (!url) {
      toast('请填写链接地址', 'error');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast('请填写 http(s) 开头的链接', 'error');
      return;
    }

    var isPhoto = state.linkType === 'photo';
    var title = document.getElementById('linkTitle').value.trim();
    var caption = document.getElementById('linkCaption').value.trim();
    var fallbackName = '外部链接';
    try {
      var parsed = new URL(url);
      fallbackName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname);
    } catch (err) { /* noop */ }

    if (isPhoto) {
      closeModal('linkModal');
      toast('图片展示已合并到封面，不再单独添加图片', 'info', 4200);
      return;
    }
    if (!state.github) {
      closeModal('linkModal');
      toast('请先配置 GitHub，才能把链接发布给访客', 'info', 4200);
      openPublishModal();
      return;
    }

    try {
      await window.GitHubStore.addExternalLink(state.github, {
        name: title || fallbackName || '资料',
        url: url
      });
      state.files = await loadPublicFiles();
      renderFiles();
      renderCounts();
      closeModal('linkModal');
      toast('资料链接已发布到公开清单', 'success', 4200);
    } catch (error) {
      reportError(error);
    }
  }

  /* ----------------------------------------------------------------------
     GitHub publish settings
     ---------------------------------------------------------------------- */
  function openPublishModal() {
    var cfg = state.github;
    document.getElementById('ghOwner').value = cfg ? cfg.owner : '';
    document.getElementById('ghRepo').value = cfg ? cfg.repo : '';
    document.getElementById('ghBranch').value = cfg ? (cfg.branch || 'main') : 'main';
    document.getElementById('ghToken').value = cfg ? cfg.token : '';
    setGithubStatus(cfg ? ('已保存 ' + cfg.owner + '/' + cfg.repo + '，点击“测试连接”确认权限。') : '尚未连接 GitHub。');
    openModal('publishModal', '#ghOwner');
  }

  function setGithubStatus(message, kind) {
    var node = document.getElementById('ghStatus');
    if (!node) return;
    node.textContent = message;
    node.className = 'settings-status' + (kind ? ' is-' + kind : '');
  }

  function configFromFields() {
    var owner = document.getElementById('ghOwner').value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
    var repo = document.getElementById('ghRepo').value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
    var branch = document.getElementById('ghBranch').value.trim() || 'main';
    var token = document.getElementById('ghToken').value.trim();
    if (owner.indexOf('/') !== -1) {
      var parts = owner.split('/').filter(Boolean);
      owner = parts[0];
      if (!repo && parts[1]) repo = parts[1];
    }
    if (!owner) throw new Error('请填写 GitHub 用户名或组织');
    if (!repo) throw new Error('请填写仓库名');
    if (!token || token.length < 10) throw new Error('请填写有效的 GitHub Token');
    return { owner: owner, repo: repo, branch: branch, token: token };
  }

  async function testGithubConfig(cfg, quiet) {
    setGithubStatus('正在连接 GitHub…');
    try {
      var repo = await window.GitHubStore.test(cfg);
      var canWrite = repo && repo.permissions && repo.permissions.push;
      setGithubStatus(
        '已连接 ' + (repo.full_name || (cfg.owner + '/' + cfg.repo)) +
        (canWrite ? '，Token 有写入权限。' : '，但 Token 似乎没有写入权限。'),
        canWrite ? 'ok' : 'warn'
      );
      if (!quiet) toast(canWrite ? 'GitHub 连接正常' : '连接成功，但可能没有写入权限', canWrite ? 'success' : 'error', 4200);
      return canWrite;
    } catch (error) {
      setGithubStatus(error.message || '连接失败', 'error');
      if (!quiet) toast(error.message || '连接失败', 'error', 5200);
      return false;
    }
  }

  async function savePublishConfig(event) {
    event.preventDefault();
    var cfg;
    try {
      cfg = configFromFields();
    } catch (error) {
      setGithubStatus(error.message, 'error');
      return;
    }

    window.GitHubStore.save(cfg);
    state.github = cfg;
    await testGithubConfig(cfg, true);
    state.files = await loadPublicFiles();
    renderFiles();
    renderCounts();
    updateStorage();
    toast('GitHub 配置已保存在本机浏览器', 'success', 4200);
    if (!state.settings.noticeDismissed) {
      state.settings.noticeDismissed = true;
      renderNotice();
      persistSettings();
    }
  }

  function clearGithubConfig() {
    if (!state.github) {
      document.getElementById('ghToken').value = '';
      setGithubStatus('尚未连接 GitHub。');
      return;
    }
    askConfirm({
      title: '清除 GitHub 配置？',
      message: 'Token 会从当前浏览器删除，已经发布的公开资料不会被删除。',
      okText: '清除配置',
      onConfirm: async function () {
        window.GitHubStore.clear();
        state.github = null;
        document.getElementById('ghToken').value = '';
        setGithubStatus('已清除配置，当前浏览为访客模式。');
        state.files = await loadPublicFiles();
        renderFiles();
        renderCounts();
        updateStorage();
        toast('GitHub 配置已清除');
      }
    });
  }

  async function publishProfile() {
    if (!state.github) {
      setGithubStatus('请先保存 GitHub 配置，再发布名片。', 'error');
      return;
    }
    if (!state.storageReady && (state.settings.profile.avatarMediaId || state.settings.profile.coverMediaId)) {
      toast('本机存储不可用，无法读取头像或封面', 'error');
      return;
    }

    var button = document.getElementById('publishProfileBtn');
    button.disabled = true;
    setGithubStatus('正在发布名片与封面…');
    try {
      var profile = Object.assign({}, state.settings.profile);
      var avatarPath = profile.avatarUrl || '';
      var coverPath = profile.coverUrl || '';

      if (profile.avatarMediaId) {
        try {
          var avatar = await DB.getMedia(profile.avatarMediaId);
          if (avatar && avatar.blob) {
            await window.GitHubStore.uploadAsset(state.github, 'public/avatar.jpg', avatar.blob, 'Publish avatar');
            avatarPath = 'public/avatar.jpg';
          }
        } catch (error) { console.warn(error); }
      }
      if (profile.coverMediaId) {
        try {
          var cover = await DB.getMedia(profile.coverMediaId);
          if (cover && cover.blob) {
            await window.GitHubStore.uploadAsset(state.github, 'public/cover.jpg', cover.blob, 'Publish cover');
            coverPath = 'public/cover.jpg';
          }
        } catch (error) { console.warn(error); }
      }

      delete profile.avatarMediaId;
      delete profile.avatarUrl;
      delete profile.coverMediaId;
      delete profile.coverUrl;

      await window.GitHubStore.publishSite(state.github, {
        profile: profile,
        avatar: avatarPath,
        cover: coverPath,
        theme: state.settings.theme,
        updatedAt: new Date().toISOString()
      });

      setGithubStatus('名片已发布，GitHub Pages 约 1 分钟后更新。', 'ok');
      toast('名片与封面已发布，约 1 分钟后访客可见', 'success', 6200);
    } catch (error) {
      setGithubStatus(error.message || '发布失败', 'error');
      reportError(error);
    } finally {
      button.disabled = false;
    }
  }

  /* ----------------------------------------------------------------------
     Profile editor
     ---------------------------------------------------------------------- */
  function openProfileEditor() {
    var profile = state.settings.profile;
    state.pendingAvatar = null;
    state.avatarRemoved = false;

    document.getElementById('fieldSiteTitle').value = profile.siteTitle || '';
    document.getElementById('fieldName').value = profile.name || '';
    document.getElementById('fieldTagline').value = profile.tagline || '';
    document.getElementById('fieldHeadline').value = profile.headline || '';
    document.getElementById('fieldStatus').value = profile.status || '';
    document.getElementById('fieldBio').value = profile.bio || '';
    document.getElementById('fieldLocation').value = profile.location || '';
    document.getElementById('fieldEmail').value = profile.email || '';
    document.getElementById('fieldTags').value = (profile.tags || []).join(', ');
    document.getElementById('fieldGithub').value = profile.github || '';
    document.getElementById('fieldBilibili').value = profile.bilibili || '';
    document.getElementById('fieldWebsite').value = profile.website || '';
    document.getElementById('fieldAvatarUrl').value = profile.avatarUrl || '';
    document.getElementById('avatarPreview').src = dom.profileAvatar.src || DEFAULT_AVATAR;

    openModal('profileModal', '#fieldName');
  }

  async function saveProfile(event) {
    event.preventDefault();
    var profile = state.settings.profile;

    profile.siteTitle = document.getElementById('fieldSiteTitle').value.trim() || '我的资料库';
    profile.name = document.getElementById('fieldName').value.trim() || '你的名字';
    profile.tagline = document.getElementById('fieldTagline').value.trim();
    profile.headline = document.getElementById('fieldHeadline').value.trim();
    profile.status = document.getElementById('fieldStatus').value.trim() || '开放交流';
    profile.bio = document.getElementById('fieldBio').value.trim();
    profile.location = document.getElementById('fieldLocation').value.trim();
    profile.email = document.getElementById('fieldEmail').value.trim();
    profile.tags = document.getElementById('fieldTags').value.split(/[,，]/)
      .map(function (tag) { return tag.trim(); })
      .filter(Boolean).slice(0, 8);
    profile.github = document.getElementById('fieldGithub').value.trim();
    profile.bilibili = document.getElementById('fieldBilibili').value.trim();
    profile.website = document.getElementById('fieldWebsite').value.trim();

    var avatarUrl = document.getElementById('fieldAvatarUrl').value.trim();

    try {
      if (state.pendingAvatar) {
        var file = state.pendingAvatar;
        await DB.putMedia({
          id: 'avatar',
          kind: 'asset',
          name: file.name || 'avatar',
          mime: file.type || 'image/jpeg',
          size: file.size || 0,
          createdAt: Date.now(),
          blob: file
        });
        revokeMedia('avatar');
        profile.avatarMediaId = 'avatar';
        profile.avatarUrl = '';
      } else if (avatarUrl) {
        profile.avatarMediaId = '';
        profile.avatarUrl = normalizeUrl(avatarUrl);
      } else if (state.avatarRemoved) {
        profile.avatarMediaId = '';
        profile.avatarUrl = '';
      }

      await persistSettings();
      await updateImages();
      renderProfile();
      closeModal('profileModal');
      toast('名片已保存');
    } catch (error) {
      reportError(error);
    }
  }

  function previewAvatarFile(file) {
    if (!file) return;
    state.pendingAvatar = file;
    state.avatarRemoved = false;
    var url = URL.createObjectURL(file);
    document.getElementById('avatarPreview').src = url;
    document.getElementById('fieldAvatarUrl').value = '';
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  /* ----------------------------------------------------------------------
     Confirm dialog
     ---------------------------------------------------------------------- */
  function askConfirm(options) {
    state.confirmAction = options.onConfirm || null;
    document.getElementById('confirmTitle').textContent = options.title || '确认操作？';
    document.getElementById('confirmMessage').textContent = options.message || '';
    document.getElementById('confirmOk').textContent = options.okText || '确认';
    openModal('confirmModal', '#confirmCancel');
  }

  async function runConfirm() {
    var action = state.confirmAction;
    state.confirmAction = null;
    closeModal('confirmModal');
    if (!action) return;
    try {
      await action();
    } catch (error) {
      reportError(error);
    }
  }

  /* ----------------------------------------------------------------------
     Modals + lightbox
     ---------------------------------------------------------------------- */
  function syncLock() {
    var anyModal = Array.prototype.some.call(document.querySelectorAll('.modal'), function (modal) {
      return !modal.hidden;
    });
    var lightboxOpen = dom.lightbox && !dom.lightbox.hidden;
    document.body.classList.toggle('is-locked', anyModal || lightboxOpen);
  }

  function openModal(id, focusSelector) {
    var modal = document.getElementById(id);
    if (!modal) return;
    state.lastFocused = document.activeElement;
    modal.hidden = false;
    syncLock();

    var target = focusSelector ? modal.querySelector(focusSelector) : null;
    if (!target) {
      target = modal.querySelector('input:not([type="hidden"]), textarea, .modal-actions .btn');
    }
    if (target) setTimeout(function () { target.focus({ preventScroll: true }); }, 60);
  }

  function closeModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = true;
    syncLock();
    if (id === 'profileModal') {
      state.pendingAvatar = null;
      state.avatarRemoved = false;
    }
    if (state.lastFocused && typeof state.lastFocused.focus === 'function') {
      try { state.lastFocused.focus({ preventScroll: true }); } catch (err) { /* noop */ }
    }
  }

  function openLightbox(index) {
    if (!state.photos.length) return;
    state.galleryIndex = clamp(index, 0, state.photos.length - 1);
    dom.lightbox.hidden = false;
    renderLightbox();
    syncLock();
  }

  function renderLightbox() {
    var record = state.photos[state.galleryIndex];
    if (!record) return;
    dom.lightboxImg.src = mediaUrl(record);
    dom.lightboxImg.alt = record.caption || record.name || '图片';
    dom.lightboxCaption.textContent = record.caption || record.name || '';
    dom.lightboxCount.textContent = (state.galleryIndex + 1) + ' / ' + state.photos.length;
    var multiple = state.photos.length > 1;
    dom.lightboxPrev.hidden = !multiple;
    dom.lightboxNext.hidden = !multiple;
  }

  function stepLightbox(delta) {
    if (!state.photos.length) return;
    state.galleryIndex = (state.galleryIndex + delta + state.photos.length) % state.photos.length;
    renderLightbox();
  }

  function closeLightbox() {
    dom.lightbox.hidden = true;
    dom.lightboxImg.removeAttribute('src');
    syncLock();
  }

  function deleteLightboxPhoto() {
    var record = state.photos[state.galleryIndex];
    if (record) confirmDeletePhoto(record);
  }

  async function coverFromLightbox() {
    var record = state.photos[state.galleryIndex];
    if (!record) return;
    await setCoverFromRecord(record);
  }

  /* ----------------------------------------------------------------------
     Music player
     ---------------------------------------------------------------------- */
  function currentTrack() {
    return state.tracks[state.trackIndex] || null;
  }

  function updateMediaSession(record) {
    if (!('mediaSession' in navigator) || !record) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: record.title || record.name || '音乐',
        artist: record.artist || '本地音乐',
        album: '个人资料库'
      });
      navigator.mediaSession.setActionHandler('play', function () { playAudio(); });
      navigator.mediaSession.setActionHandler('pause', function () { dom.audio.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', function () { stepTrack(-1, true); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { stepTrack(1, true); });
    } catch (error) {
      console.warn(error);
    }
  }

  function setTrack(index, autoplay) {
    if (!state.tracks.length) {
      resetPlayer();
      return;
    }
    state.trackIndex = clamp(index, 0, state.tracks.length - 1);
    var record = currentTrack();
    var source = mediaUrl(record);
    state.audioFailed = false;

    if (source) {
      dom.audio.src = source;
      dom.audio.load();
    }
    renderPlayer();
    updateMediaSession(record);
    persistPlayerState();

    if (autoplay) playAudio();
  }

  function removeAutoplayHint() {
    var hint = document.getElementById('autoplayHint');
    if (hint) hint.remove();
    if (state.autoplayGestureHandler) {
      document.removeEventListener('pointerdown', state.autoplayGestureHandler, true);
      state.autoplayGestureHandler = null;
    }
  }

  function showAutoplayHint() {
    if (!state.tracks.length || document.getElementById('autoplayHint')) return;
    var hint = document.createElement('button');
    hint.id = 'autoplayHint';
    hint.type = 'button';
    hint.className = 'autoplay-hint';
    hint.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-music"></use></svg><span>点击播放背景音乐</span>';
    hint.addEventListener('click', function () {
      hint.remove();
      playAudio();
    });
    document.body.appendChild(hint);
    if (!state.autoplayGestureHandler) {
      state.autoplayGestureHandler = function (event) {
        var target = event.target;
        if (target && target.closest && target.closest('#autoplayHint')) return;
        document.removeEventListener('pointerdown', state.autoplayGestureHandler, true);
        state.autoplayGestureHandler = null;
        playAudio();
      };
      document.addEventListener('pointerdown', state.autoplayGestureHandler, true);
    }
  }

  function tryAutoplay() {
    if (state.autoplayAttempted || !state.tracks.length) return;
    state.autoplayAttempted = true;
    if (!dom.audio.getAttribute('src')) {
      setTrack(state.trackIndex < 0 ? 0 : state.trackIndex, false);
    }
    playAudio();
  }

  function playAudio() {
    if (!state.tracks.length) return;
    if (!dom.audio.getAttribute('src')) {
      setTrack(state.trackIndex < 0 ? 0 : state.trackIndex, false);
    }
    var promise = dom.audio.play();
    if (promise && typeof promise.then === 'function') {
      promise.then(function () {
        removeAutoplayHint();
      }).catch(function (error) {
        console.warn(error);
        if (error && error.name === 'NotAllowedError') {
          showAutoplayHint();
        } else if (!state.audioFailed) {
          state.audioFailed = true;
          toast('无法播放这首音乐，请检查文件格式', 'error');
        }
      });
    } else if (promise && typeof promise.catch === 'function') {
      promise.catch(function (error) {
        console.warn(error);
        if (error && error.name === 'NotAllowedError') showAutoplayHint();
      });
    }
  }

  function togglePlay() {
    if (!state.tracks.length) {
      openPlayerPanel();
      dom.trackInput.click();
      toast('先添加一首本地音乐吧', 'info');
      return;
    }
    if (dom.audio.paused) playAudio();
    else dom.audio.pause();
  }

  function stepTrack(delta, autoplay) {
    if (!state.tracks.length) return;
    var next = state.trackIndex + delta;
    if (next < 0) next = state.tracks.length - 1;
    if (next >= state.tracks.length) next = 0;
    setTrack(next, autoplay);
  }

  function nextTrack(fromEnded) {
    if (!state.tracks.length) return;
    if (state.repeat === 'one' && fromEnded) {
      dom.audio.currentTime = 0;
      playAudio();
      return;
    }
    var isLast = state.trackIndex >= state.tracks.length - 1;
    if (fromEnded && state.repeat === 'off' && isLast) {
      dom.audio.pause();
      dom.audio.currentTime = 0;
      updatePlayUi();
      return;
    }
    stepTrack(1, true);
  }

  function resetPlayer() {
    dom.audio.pause();
    dom.audio.removeAttribute('src');
    try { dom.audio.load(); } catch (err) { /* noop */ }
    state.trackIndex = -1;
    setText('pbTitle', '尚未选择音乐');
    setText('pbArtist', '点击右侧播放');
    setText('ppTitle', '尚未选择音乐');
    setText('ppArtist', '上传一首歌，开始播放');
    setText('timeCurrent', '0:00');
    setText('timeTotal', '0:00');
    dom.seekBar.value = 0;
    updateRange(dom.seekBar, 0);
    updatePlayUi();
    renderPlayer();
  }

  function renderPlayer() {
    var record = currentTrack();

    if (record) {
      var title = record.title || record.name || '未命名音乐';
      var artist = record.artist || (record.public || record.publicPath ? '公开音乐' : '本地音乐');
      setText('pbTitle', title);
      setText('pbArtist', artist);
      setText('ppTitle', title);
      setText('ppArtist', artist);
    } else {
      setText('pbTitle', '尚未选择音乐');
      setText('pbArtist', '点击右侧播放');
      setText('ppTitle', '尚未选择音乐');
      setText('ppArtist', '上传一首歌，开始播放');
    }

    setText('trackCount', state.tracks.length);
    dom.playlistEmpty.hidden = state.tracks.length > 0;
    dom.playlist.hidden = state.tracks.length === 0;
    dom.playlist.innerHTML = '';

    state.tracks.forEach(function (track, index) {
      var isCurrent = index === state.trackIndex;
      var trackTitle = track.title || track.name || '未命名音乐';

      var item = h('li', {
        class: isCurrent ? 'is-current' : '',
        dataset: { index: String(index) },
        title: trackTitle
      },
        h('span', { class: 'track-index' }, isCurrent ? '▸' : String(index + 1).padStart(2, '0')),
        h('span', { class: 'track-title' }, trackTitle),
        h('span', { class: 'track-time' }, track.duration ? formatTime(track.duration) : '--:--')
      );

      if (state.github && !track.publishing) {
        item.appendChild(h('button', {
          class: 'track-del', type: 'button', title: '移除', 'aria-label': '移除这首音乐',
          onclick: guard(function (event) {
            event.stopPropagation();
            return removeTrack(track.id);
          })
        }, icon('trash')));
      }

      item.addEventListener('click', guard(function () {
        if (index === state.trackIndex) togglePlay();
        else setTrack(index, true);
      }));

      dom.playlist.appendChild(item);
    });

    if (dom.publishTracksBtn) {
      var pendingTracks = state.tracks.filter(function (track) {
        return track.blob && !track.publicPath;
      });
      dom.publishTracksBtn.hidden = !pendingTracks.length;
      dom.publishTracksBtn.disabled = state.tracks.some(function (track) { return track.publishing; });
    }

    updatePlayUi();
    updateRepeatUi();
  }

  function updatePlayUi() {
    var playing = !dom.audio.paused && !dom.audio.ended && !!dom.audio.getAttribute('src');
    dom.player.classList.toggle('is-playing', playing);
    dom.playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
    dom.pbPlay.setAttribute('aria-label', playing ? '暂停' : '播放');
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch (err) { /* noop */ }
    }
  }

  function updateRepeatUi() {
    dom.repeatBtn.classList.toggle('is-active', state.repeat !== 'off');
    dom.repeatBtn.classList.toggle('is-one', state.repeat === 'one');
    var labels = { off: '循环模式：关闭', all: '循环模式：列表循环', one: '循环模式：单曲循环' };
    dom.repeatBtn.title = labels[state.repeat];
    dom.repeatBtn.setAttribute('aria-label', labels[state.repeat]);
  }

  function cycleRepeat() {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    updateRepeatUi();
    persistPlayerState();
    toast(state.repeat === 'off' ? '循环已关闭' : state.repeat === 'all' ? '列表循环' : '单曲循环', 'info', 1800);
  }

  function updateRange(input, ratio) {
    var percent = clamp(ratio, 0, 1) * 100;
    input.style.setProperty('--progress', percent.toFixed(2) + '%');
  }

  function updateTimeDisplay() {
    var duration = dom.audio.duration;
    var current = dom.audio.currentTime || 0;
    if (isFinite(duration) && duration > 0) {
      dom.seekBar.value = String(Math.round((current / duration) * 1000));
      updateRange(dom.seekBar, current / duration);
      setText('timeTotal', formatTime(duration));
    } else {
      dom.seekBar.value = 0;
      updateRange(dom.seekBar, 0);
      setText('timeTotal', '0:00');
    }
    setText('timeCurrent', formatTime(current));
  }

  function persistPlayerState() {
    try {
      localStorage.setItem('atlas-player', JSON.stringify({
        volume: dom.audio.volume,
        repeat: state.repeat,
        trackId: currentTrack() ? currentTrack().id : ''
      }));
    } catch (error) { /* noop */ }
  }

  function readPlayerState() {
    try {
      var raw = localStorage.getItem('atlas-player');
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      return {};
    }
  }

  function initPlayer() {
    var saved = readPlayerState();
    state.repeat = ['off', 'all', 'one'].indexOf(saved.repeat) >= 0 ? saved.repeat : 'all';

    var volume = typeof saved.volume === 'number' ? clamp(saved.volume, 0, 1) : 0.8;
    dom.audio.volume = volume;
    dom.volumeBar.value = String(Math.round(volume * 100));
    updateRange(dom.volumeBar, volume);

    var index = state.tracks.findIndex(function (track) { return track.id === saved.trackId; });
    if (index < 0) index = state.tracks.length ? 0 : -1;
    state.trackIndex = index;

    if (index >= 0) {
      var record = state.tracks[index];
      var source = mediaUrl(record);
      if (source) dom.audio.src = source;
      updateMediaSession(record);
    }

    updateRepeatUi();
    renderPlayer();
    updatePlayUi();
    tryAutoplay();
  }

  async function publishTrackRecords(records) {
    var list = (records || []).filter(function (record) { return record && record.blob && !record.publicPath; });
    if (!list.length) return [];
    if (!state.github || !window.GitHubStore) return [];
    list.forEach(function (record) { record.publishing = true; });
    renderPlayer();
    try {
      toast('正在发布 ' + list.length + ' 首音乐给访客…', 'info', 2600);
      var entries = await window.GitHubStore.publishTracks(state.github, list, function (done, total, name) {
        setText('pbArtist', '正在发布 ' + done + '/' + total + ' · ' + name);
      });
      entries.forEach(function (entry, index) {
        var record = list[index];
        if (!record) return;
        if (state.tracks.indexOf(record) < 0) {
          // The track was removed while it was uploading; don't resurrect it, clean the remote copy.
          window.GitHubStore.removeTrack(state.github, { publicPath: entry.path, title: record.title }).catch(function (error) {
            console.warn(error);
          });
          return;
        }
        record.publicPath = entry.path;
        record.publicUrl = publicUrl(entry);
        if (state.storageReady) {
          DB.putMedia(record).catch(function (error) { console.warn(error); });
        }
      });
      renderPlayer();
      renderCounts();
      updateStorage();
      toast('音乐已发布，访客进入页面就能听到', 'success', 5000);
      return entries;
    } catch (error) {
      reportError(error);
      toast('音乐只保存在本机，发布失败：' + (error.message || '请稍后重试'), 'error', 6000);
      return [];
    } finally {
      list.forEach(function (record) { record.publishing = false; });
      renderPlayer();
      updateStorage();
    }
  }

  async function publishLocalTracks() {
    if (!state.github) {
      openPublishModal();
      toast('先连接 GitHub，才能把音乐公开给访客', 'info', 4200);
      return;
    }
    var pending = state.tracks.filter(function (track) { return track.blob && !track.publicPath; });
    if (!pending.length) {
      toast('本机音乐都已经发布了', 'info');
      return;
    }
    await publishTrackRecords(pending);
  }

  async function addTracks(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (file) {
      return (file.type || '').indexOf('audio/') === 0 ||
        /\.(mp3|wav|ogg|m4a|flac|aac|opus|weba)$/i.test(file.name);
    });
    if (!files.length) {
      toast('请选择音频文件（mp3、wav、m4a 等）', 'error');
      return;
    }
    if (!state.storageReady) {
      toast('本地存储不可用，无法保存音乐', 'error');
      return;
    }

    var firstId = '';
    var publishQueue = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var duration = await readAudioDuration(file);
      var meta = parseTrackName(file.name);
      var record = {
        id: uid(),
        kind: 'audio',
        name: file.name,
        title: meta.title,
        artist: meta.artist,
        mime: file.type || 'audio/mpeg',
        size: file.size || 0,
        duration: duration,
        createdAt: Date.now() + i,
        blob: file
      };
      try {
        await DB.putMedia(record);
        state.tracks.push(record);
        if (!firstId) firstId = record.id;
        if (state.github) publishQueue.push(record);
      } catch (error) {
        console.error(error);
        toast('「' + file.name + '」添加失败：' + (error.message || '存储空间不足'), 'error', 5000);
      }
    }

    state.tracks.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    renderPlayer();
    renderCounts();
    updateStorage();

    if (firstId) {
      var index = state.tracks.findIndex(function (track) { return track.id === firstId; });
      if (index >= 0) {
        setTrack(index, true);
        openPlayerPanel();
        toast('已添加 ' + files.length + ' 首音乐');
      }
    }

    if (publishQueue.length) {
      publishTrackRecords(publishQueue);
    } else if (files.length && !state.github) {
      toast('音乐目前只保存在本机；在「发布」里连接 GitHub 后，访客才能听到', 'info', 6000);
    }
  }

  async function removeTrack(id) {
    var index = state.tracks.findIndex(function (track) { return track.id === id; });
    if (index < 0) return;
    var record = state.tracks[index];
    var isPublic = !!(record.public || record.publicPath);
    var wasCurrent = index === state.trackIndex;

    if (record.publishing) {
      toast('这首音乐正在发布，请稍候再删除', 'info');
      return;
    }

    if (isPublic && !state.github) {
      toast('访客只能播放公开音乐，不能删除', 'info');
      return;
    }
    if (isPublic && !window.GitHubStore) {
      toast('GitHub 客户端未加载，暂时无法删除公开音乐', 'error');
      return;
    }
    if (isPublic) {
      try {
        await window.GitHubStore.removeTrack(state.github, record);
      } catch (error) {
        reportError(error);
        toast('公开音乐删除失败，请稍后重试', 'error');
        return;
      }
    }

    try {
      await DB.deleteMedia(record.id);
    } catch (error) {
      if (!record.public) {
        reportError(error);
        return;
      }
    }
    revokeMedia(record.id);
    state.tracks.splice(index, 1);

    if (!state.tracks.length) {
      resetPlayer();
    } else if (wasCurrent) {
      state.trackIndex = clamp(index, 0, state.tracks.length - 1);
      setTrack(state.trackIndex, false);
    } else {
      if (index < state.trackIndex) state.trackIndex--;
      renderPlayer();
    }

    renderCounts();
    updateStorage();
    persistPlayerState();
    toast(isPublic ? '已从公开列表移除' : '音乐已移除');
  }

  function openPlayerPanel() {
    dom.playerPanel.hidden = false;
    dom.player.classList.add('is-open');
    dom.expandBtn.setAttribute('aria-expanded', 'true');
    dom.playerPanel.scrollTop = 0;
  }

  function closePlayerPanel() {
    dom.playerPanel.hidden = true;
    dom.player.classList.remove('is-open');
    dom.expandBtn.setAttribute('aria-expanded', 'false');
  }

  function togglePlayerPanel() {
    if (dom.playerPanel.hidden) openPlayerPanel();
    else closePlayerPanel();
  }

  function playFromHero() {
    openPlayerPanel();
    if (!state.tracks.length) {
      dom.trackInput.click();
      toast('添加一首音乐后即可播放', 'info');
      return;
    }
    playAudio();
  }

  /* ----------------------------------------------------------------------
     Storage meter + notice
     ---------------------------------------------------------------------- */
  async function updateStorage() {
    var publicBytes = state.files.reduce(function (sum, record) {
      return sum + (record.public ? (record.size || 0) : 0);
    }, 0);
    publicBytes += state.tracks.reduce(function (sum, track) {
      return sum + (track.public || track.publicPath ? (track.size || 0) : 0);
    }, 0);

    setText('storageText', formatBytes(publicBytes) + (state.github ? ' · 已连接' : ' 公开'));
    var percent = clamp((publicBytes / (100 * 1024 * 1024)) * 100, 0, 100);
    if (dom.storageBar) dom.storageBar.style.width = percent.toFixed(2) + '%';
  }

  function renderNotice() {
    if (dom.localNotice) dom.localNotice.hidden = !!state.settings.noticeDismissed;
  }

  async function dismissNotice() {
    state.settings.noticeDismissed = true;
    renderNotice();
    await persistSettings();
  }

  /* ----------------------------------------------------------------------
     Backup
     ---------------------------------------------------------------------- */
  function stamp() {
    var now = new Date();
    function pad(value) { return String(value).padStart(2, '0'); }
    return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes());
  }

  async function exportBackup() {
    if (!state.storageReady) {
      toast('本地存储不可用，无法导出备份', 'error');
      return;
    }
    var buttons = [dom.exportBtn, dom.noticeExportBtn].filter(Boolean);
    buttons.forEach(function (button) { button.disabled = true; });
    try {
      var all = await DB.getAllMedia();
      var total = all.reduce(function (sum, record) { return sum + (record.size || 0); }, 0);
      if (total > 150 * 1024 * 1024) {
        toast('资料较大，正在打包，请勿关闭页面…', 'info', 6000);
      } else {
        toast('正在打包备份…', 'info', 2200);
      }

      var payload = {
        app: 'atlas-library',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: state.settings,
        media: []
      };

      for (var i = 0; i < all.length; i++) {
        var record = all[i];
        var copy = Object.assign({}, record);
        delete copy.blob;
        if (record.blob) copy.data = await blobToDataURL(record.blob);
        payload.media.push(copy);
      }

      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      downloadBlob(blob, 'atlas-library-backup-' + stamp() + '.json');
      toast('备份已导出，请妥善保存');
    } catch (error) {
      reportError(error);
    } finally {
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  function importBackup(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || data.app !== 'atlas-library' || !Array.isArray(data.media)) {
          throw new Error('这不是有效的资料库备份文件');
        }
        askConfirm({
          title: '导入备份？',
          message: '导入会覆盖当前浏览器中的全部资料、图片、音乐和名片设置。',
          okText: '覆盖并导入',
          onConfirm: function () { return applyBackup(data); }
        });
      } catch (error) {
        reportError(error);
      }
    };
    reader.onerror = function () { toast('读取备份文件失败', 'error'); };
    reader.readAsText(file);
  }

  async function applyBackup(data) {
    if (!state.storageReady) {
      toast('本地存储不可用，无法导入备份', 'error');
      return;
    }
    toast('正在恢复备份…', 'info', 4000);

    var records = [];
    for (var i = 0; i < data.media.length; i++) {
      var item = data.media[i];
      if (!item || !item.id) continue;
      var record = {
        id: item.id,
        kind: item.kind || 'file',
        name: item.name || '未命名文件',
        mime: item.mime || '',
        size: item.size || 0,
        createdAt: item.createdAt || Date.now(),
        caption: item.caption,
        url: item.url,
        title: item.title,
        artist: item.artist,
        duration: item.duration
      };
      if (!record.url && item.data) {
        var response = await fetch(item.data);
        record.blob = await response.blob();
      }
      records.push(record);
    }

    await DB.clearMedia();
    urlCache.forEach(function (url) { URL.revokeObjectURL(url); });
    urlCache.clear();

    for (var j = 0; j < records.length; j++) {
      await DB.putMedia(records[j]);
    }

    if (data.settings) {
      state.settings = normalizeSettings(data.settings);
      try { localStorage.setItem('atlas-theme', state.settings.theme); } catch (err) { /* noop */ }
      applyTheme(state.settings.theme, false);
    }

    await DB.saveSettings(state.settings);

    var lists = await Promise.all([
      DB.listMedia('audio')
    ]);
    state.files = await loadPublicFiles();
    state.photos = [];
    state.tracks = lists[0].sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });

    state.trackIndex = state.tracks.length ? 0 : -1;
    resetPlayer();
    renderAll();
    renderNotice();
    updateImages();
    updateStorage();
    initPlayer();
    toast('备份已恢复');
  }

  /* ----------------------------------------------------------------------
     Theme + misc UI
     ---------------------------------------------------------------------- */
  function applyTheme(theme, persist) {
    var next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#15120f' : '#fbf5f2');
    try { localStorage.setItem('atlas-theme', next); } catch (error) { /* noop */ }
    if (state.settings) state.settings.theme = next;
    if (persist && state.settings) persistSettings();
  }

  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
  }

  function initReveal() {
    var sections = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(sections, function (section) { section.classList.add('is-visible'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    Array.prototype.forEach.call(sections, function (section) { observer.observe(section); });
  }

  function renderAll() {
    renderProfile();
    renderCounts();
    renderGallery();
    renderFiles();
    renderPlayer();
    renderNotice();
    updateImages();
  }

  /* ----------------------------------------------------------------------
     Event wiring
     ---------------------------------------------------------------------- */
  function cacheDom() {
    var ids = [
      'siteHeader', 'brandAvatarImg', 'brandName', 'themeToggle', 'editProfileTop', 'publishBtn',
      'heroBg', 'heroTitle', 'heroSubtitle', 'heroStatus', 'heroTags', 'heroPlayBtn',
      'heroFileCount', 'heroPhotoCount', 'heroTrackCount', 'changeCoverBtn', 'resetCoverBtn', 'coverInput',
      'profileAvatar', 'profileName', 'profileHeadline', 'profileBio', 'profileTags',
      'profileLinks', 'statFiles', 'statPhotos', 'statTracks', 'editProfileBtn',
      'galleryGrid', 'galleryEmpty', 'galleryCount', 'addPhotosBtn', 'addPhotoLinkBtn', 'photoInput',
      'fileList', 'filesEmpty', 'fileCount', 'fileInput', 'addFilesBtn', 'addFileLinkBtn',
      'dropzone', 'dropzoneBrowse', 'fileSearch', 'storageText', 'storageBar', 'fileNoResults',
      'filesPanel',
      'exportBtn', 'importBtn', 'importInput', 'localNotice', 'noticeCloseBtn', 'noticeExportBtn',
      'player', 'playerPanel', 'audio', 'pbTitle', 'pbArtist', 'ppTitle', 'ppArtist',
      'playBtn', 'pbPlay', 'prevBtn', 'nextBtn', 'repeatBtn', 'expandBtn', 'vinylBtn', 'seekBar',
      'timeCurrent', 'timeTotal', 'volumeBar', 'playlist', 'playlistEmpty', 'trackCount',
      'trackInput', 'addTrackBtn', 'addTrackLink', 'publishTracksBtn', 'profileModal', 'avatarPreview',
      'linkModal', 'confirmModal', 'confirmOk', 'confirmCancel', 'confirmTitle', 'confirmMessage',
      'lightbox', 'lightboxImg', 'lightboxCaption', 'lightboxCount', 'lightboxPrev',
      'lightboxNext', 'lightboxClose', 'lightboxDelete', 'lightboxSetCover', 'toasts',
      'footerName', 'footerName2', 'footerYear', 'heroYear', 'profileAside', 'avatarInput',
      'publishModal', 'publishForm', 'ghOwner', 'ghRepo', 'ghBranch', 'ghToken', 'ghStatus',
      'ghClearBtn', 'ghTestBtn', 'publishProfileBtn',
      'passwordModal', 'passwordForm', 'downloadPassword', 'passwordError'
    ];
    ids.forEach(function (id) { dom[id] = document.getElementById(id); });
  }

  function bindEvents() {
    dom.themeToggle.addEventListener('click', toggleTheme);
    dom.publishBtn.addEventListener('click', openPublishModal);
    dom.editProfileTop.addEventListener('click', openProfileEditor);
    dom.editProfileBtn.addEventListener('click', openProfileEditor);

    dom.changeCoverBtn.addEventListener('click', function () { dom.coverInput.click(); });
    if (dom.resetCoverBtn) dom.resetCoverBtn.addEventListener('click', guard(resetCover));
    dom.coverInput.addEventListener('change', guard(async function () {
      var file = dom.coverInput.files && dom.coverInput.files[0];
      dom.coverInput.value = '';
      if (file) await changeCover(file);
    }));

    dom.addFilesBtn.addEventListener('click', requestFilePicker);
    dom.addFileLinkBtn.addEventListener('click', function () { openLinkModal('file'); });
    dom.fileInput.addEventListener('change', guard(function () { return addFilesFromInput(dom.fileInput, 'file'); }));

    dom.dropzoneBrowse.addEventListener('click', function (event) {
      event.stopPropagation();
      requestFilePicker();
    });
    dom.dropzone.addEventListener('click', requestFilePicker);
    dom.dropzone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        dom.fileInput.click();
      }
    });
    dom.dropzone.tabIndex = 0;
    dom.dropzone.setAttribute('role', 'button');

    ['dragenter', 'dragover'].forEach(function (type) {
      dom.dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        event.stopPropagation();
        dom.dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'dragend'].forEach(function (type) {
      dom.dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        dom.dropzone.classList.remove('is-dragover');
      });
    });
    dom.dropzone.addEventListener('drop', guard(function (event) {
      event.preventDefault();
      event.stopPropagation();
      dom.dropzone.classList.remove('is-dragover');
      if (event.dataTransfer && event.dataTransfer.files.length) {
        return addMediaFiles(event.dataTransfer.files, 'file');
      }
    }));

    if (dom.filesPanel) {
      ['dragenter', 'dragover'].forEach(function (type) {
        dom.filesPanel.addEventListener(type, function (event) {
          event.preventDefault();
          dom.filesPanel.classList.add('is-dragover');
        });
      });
      dom.filesPanel.addEventListener('dragleave', function (event) {
        if (event.relatedTarget && dom.filesPanel.contains(event.relatedTarget)) return;
        dom.filesPanel.classList.remove('is-dragover');
      });
      dom.filesPanel.addEventListener('drop', guard(function (event) {
        event.preventDefault();
        dom.filesPanel.classList.remove('is-dragover');
        if (event.dataTransfer && event.dataTransfer.files.length) {
          return addMediaFiles(event.dataTransfer.files, 'file');
        }
      }));
    }

    dom.fileSearch.addEventListener('input', function () {
      state.query = dom.fileSearch.value;
      renderFiles();
    });

    document.querySelectorAll('[data-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        var action = button.getAttribute('data-action');
        if (action === 'add-photos') dom.photoInput.click();
        if (action === 'add-photo-link') openLinkModal('photo');
        if (action === 'add-files') requestFilePicker();
        if (action === 'add-file-link') openLinkModal('file');
      });
    });

    dom.noticeCloseBtn.addEventListener('click', guard(dismissNotice));
    dom.noticeExportBtn.addEventListener('click', guard(exportBackup));
    dom.exportBtn.addEventListener('click', guard(exportBackup));
    dom.importBtn.addEventListener('click', function () { dom.importInput.click(); });
    dom.importInput.addEventListener('change', function () {
      var file = dom.importInput.files && dom.importInput.files[0];
      dom.importInput.value = '';
      if (file) importBackup(file);
    });

    document.getElementById('profileForm').addEventListener('submit', guard(saveProfile));
    document.getElementById('publishForm').addEventListener('submit', guard(savePublishConfig));
    document.getElementById('ghTestBtn').addEventListener('click', guard(async function () {
      var cfg = configFromFields();
      await testGithubConfig(cfg, false);
    }));
    document.getElementById('ghClearBtn').addEventListener('click', guard(clearGithubConfig));
    document.getElementById('publishProfileBtn').addEventListener('click', guard(publishProfile));
    document.getElementById('passwordForm').addEventListener('submit', guard(submitDownloadPassword));
    document.getElementById('avatarUploadBtn').addEventListener('click', function () { dom.avatarInput.click(); });
    dom.avatarInput.addEventListener('change', function () {
      var file = dom.avatarInput.files && dom.avatarInput.files[0];
      dom.avatarInput.value = '';
      if (file) previewAvatarFile(file);
    });
    document.getElementById('avatarResetBtn').addEventListener('click', function () {
      state.pendingAvatar = null;
      state.avatarRemoved = true;
      document.getElementById('fieldAvatarUrl').value = '';
      document.getElementById('avatarPreview').src = DEFAULT_AVATAR;
    });
    document.getElementById('fieldAvatarUrl').addEventListener('input', function (event) {
      var value = event.target.value.trim();
      if (value) {
        state.pendingAvatar = null;
        state.avatarRemoved = false;
        document.getElementById('avatarPreview').src = normalizeUrl(value);
      } else if (!state.pendingAvatar) {
        document.getElementById('avatarPreview').src = state.avatarRemoved ? DEFAULT_AVATAR : (dom.profileAvatar.src || DEFAULT_AVATAR);
      }
    });

    document.getElementById('linkForm').addEventListener('submit', guard(submitLink));
    dom.confirmOk.addEventListener('click', runConfirm);
    dom.confirmCancel.addEventListener('click', function () {
      state.confirmAction = null;
      closeModal('confirmModal');
    });

    document.addEventListener('click', function (event) {
      var closer = event.target.closest ? event.target.closest('[data-close]') : null;
      if (closer) closeModal(closer.getAttribute('data-close'));
    });

    dom.playBtn.addEventListener('click', togglePlay);
    dom.pbPlay.addEventListener('click', togglePlay);
    dom.heroPlayBtn.addEventListener('click', playFromHero);
    dom.prevBtn.addEventListener('click', function () { stepTrack(-1, true); });
    dom.nextBtn.addEventListener('click', function () { nextTrack(false); });
    dom.repeatBtn.addEventListener('click', cycleRepeat);
    dom.expandBtn.addEventListener('click', togglePlayerPanel);
    dom.vinylBtn.addEventListener('click', togglePlayerPanel);
    dom.addTrackBtn.addEventListener('click', function () { dom.trackInput.click(); });
    dom.addTrackLink.addEventListener('click', function () { dom.trackInput.click(); });
    if (dom.publishTracksBtn) dom.publishTracksBtn.addEventListener('click', guard(publishLocalTracks));
    dom.trackInput.addEventListener('change', guard(function () {
      var files = Array.prototype.slice.call(dom.trackInput.files || []);
      dom.trackInput.value = '';
      return addTracks(files);
    }));

    dom.audio.addEventListener('play', function () { removeAutoplayHint(); updatePlayUi(); });
    dom.audio.addEventListener('pause', updatePlayUi);
    dom.audio.addEventListener('loadedmetadata', updateTimeDisplay);
    dom.audio.addEventListener('durationchange', updateTimeDisplay);
    dom.audio.addEventListener('timeupdate', updateTimeDisplay);
    dom.audio.addEventListener('ended', function () { nextTrack(true); });
    dom.audio.addEventListener('error', function () {
      if (!dom.audio.getAttribute('src')) return;
      updatePlayUi();
      if (!state.audioFailed) {
        state.audioFailed = true;
        toast('音乐加载失败，可能是格式不受浏览器支持', 'error', 4200);
      }
    });

    dom.seekBar.addEventListener('input', function () {
      var duration = dom.audio.duration;
      var ratio = Number(dom.seekBar.value) / 1000;
      updateRange(dom.seekBar, ratio);
      if (isFinite(duration) && duration > 0) {
        dom.audio.currentTime = ratio * duration;
      }
    });

    dom.volumeBar.addEventListener('input', function () {
      var volume = Number(dom.volumeBar.value) / 100;
      dom.audio.volume = volume;
      updateRange(dom.volumeBar, volume);
      persistPlayerState();
    });

    document.addEventListener('click', function (event) {
      if (dom.player.classList.contains('is-open') && !dom.player.contains(event.target)) {
        closePlayerPanel();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        var openModals = Array.prototype.filter.call(document.querySelectorAll('.modal'), function (modal) {
          return !modal.hidden;
        });
        if (openModals.length) {
          closeModal(openModals[openModals.length - 1].id);
          return;
        }
        if (dom.player.classList.contains('is-open')) closePlayerPanel();
      }
    });

    window.addEventListener('scroll', function () {
      dom.siteHeader.classList.toggle('is-scrolled', window.scrollY > 12);
    }, { passive: true });

    window.addEventListener('dragover', function (event) { event.preventDefault(); });
    window.addEventListener('drop', function (event) { event.preventDefault(); });

    window.addEventListener('beforeunload', function () {
      urlCache.forEach(function (url) { URL.revokeObjectURL(url); });
      urlCache.clear();
    });
  }

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */
  async function boot() {
    cacheDom();
    bindEvents();

    try {
      await loadData();
    } catch (error) {
      console.error(error);
      state.settings = normalizeSettings(null);
    }

    renderAll();
    initReveal();
    initPlayer();
    updateStorage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
