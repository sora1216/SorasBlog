/* ==========================================================================
   Tiny GitHub Contents API client for the public library.

   The token is kept in localStorage on the owner's browser only. It is never
   written into the repository or sent anywhere except api.github.com.
   ========================================================================== */
(function () {
  'use strict';

  var API = (window.ATLAS_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
  var KEY = 'atlas-github-config';
  var FILES_PATH = 'public/files.json';
  var MUSIC_PATH = 'public/music.json';
  var MUSIC_DIR = 'public/music/';
  var GALLERY_PATH = 'public/gallery.json';
  var GALLERY_DIR = 'public/gallery/';
  var LOGS_PATH = 'public/logs.json';
  var REVIEWS_PATH = 'public/reviews.json';

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var cfg = JSON.parse(raw);
      if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) return null;
      cfg.branch = cfg.branch || 'main';
      return cfg;
    } catch (err) {
      return null;
    }
  }

  function save(cfg) {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  function encodePath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/');
  }

  function utf8ToBase64(text) {
    var bytes = new TextEncoder().encode(String(text));
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToUtf8(value) {
    var binary = atob(String(value || '').replace(/\s+/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || '');
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsDataURL(blob);
    });
  }

  async function request(cfg, path, options) {
    var settings = options || {};
    var response;
    try {
      response = await fetch(API + '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + path, {
        method: settings.method || 'GET',
        headers: {
          Authorization: 'Bearer ' + cfg.token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: settings.body
      });
    } catch (error) {
      throw new Error('无法连接 GitHub，请检查网络后重试');
    }

    var text = await response.text();
    var data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (err) { data = text; }
    }
    if (!response.ok) {
      var message = 'GitHub 返回 ' + response.status;
      if (data && data.message) message += '：' + data.message;
      if (response.status === 401) message = 'Token 无效或已过期，请重新生成';
      if (response.status === 403) message = 'Token 权限不足，请确认已勾选 Contents 读写权限';
      if (response.status === 404) message = '找不到仓库或分支，请检查用户名、仓库名和分支';
      if (response.status === 409) message = '文件冲突，请刷新后重试';
      if (response.status === 422) message = 'GitHub 拒绝写入：' + (data && data.message ? data.message : '文件可能过大');
      var error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function getFile(cfg, path) {
    try {
      return await request(cfg, '/contents/' + encodePath(path) + '?ref=' + encodeURIComponent(cfg.branch || 'main'));
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function putFile(cfg, path, base64, message, sha) {
    var body = {
      message: message,
      content: base64,
      branch: cfg.branch || 'main'
    };
    if (sha) body.sha = sha;
    return request(cfg, '/contents/' + encodePath(path), {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }

  async function removeRemoteFile(cfg, path, sha, message) {
    return request(cfg, '/contents/' + encodePath(path), {
      method: 'DELETE',
      body: JSON.stringify({
        message: message,
        sha: sha,
        branch: cfg.branch || 'main'
      })
    });
  }

  /* 只删本站自己目录下的图片，避免误删 gallery / 音乐等共用文件 */
  function isOwnedAsset(path, prefix) {
    return typeof path === 'string' && path.indexOf(prefix) === 0;
  }

  async function deleteAssetQuietly(cfg, path) {
    try {
      var existing = await getFile(cfg, path);
      if (!existing) return false;
      await removeRemoteFile(cfg, path, existing.sha, 'Delete asset ' + path);
      return true;
    } catch (error) {
      /* 删文件失败不该让“清单已更新”回滚，记一笔继续 */
      console.warn('[atlas] 删除仓库文件失败：' + path, error);
      return false;
    }
  }

  async function deleteAssets(cfg, paths, prefix) {
    var deleted = [];
    var list = Array.isArray(paths) ? paths : [];
    for (var i = 0; i < list.length; i++) {
      var path = list[i];
      if (!isOwnedAsset(path, prefix)) continue;
      if (await deleteAssetQuietly(cfg, path)) deleted.push(path);
    }
    return deleted;
  }

  async function readManifest(cfg) {
    var file = await getFile(cfg, FILES_PATH);
    var manifest = { files: [], sha: file ? file.sha : '' };
    if (file) {
      try {
        var parsed = JSON.parse(base64ToUtf8(file.content));
        if (parsed && Array.isArray(parsed.files)) manifest.files = parsed.files;
      } catch (error) {
        throw new Error('public/files.json 格式不正确，请检查仓库中的文件');
      }
    }
    return manifest;
  }

  async function writeManifest(cfg, manifest, message) {
    var payload = {
      updatedAt: new Date().toISOString(),
      files: manifest.files
    };
    return putFile(cfg, FILES_PATH, utf8ToBase64(JSON.stringify(payload, null, 2)), message, manifest.sha);
  }

  function safeName(name) {
    var value = String(name || 'file')
      .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 120);
    if (!value || /^\.+$/.test(value)) return 'file';
    return value;
  }

  async function uploadFiles(cfg, files, onProgress) {
    var manifest = await readManifest(cfg);
    var added = [];
    function flush(message) {
      if (!added.length) return Promise.resolve(null);
      return writeManifest(cfg, manifest, message);
    }
    try {
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var name = safeName(file.name);
        var path = 'public/files/' + name;
        var existing = await getFile(cfg, path);
        var base64 = await blobToBase64(file);
        var result = await putFile(cfg, path, base64, 'Upload ' + name, existing && existing.sha);
        var entry = {
          name: file.name || name,
          path: path,
          size: file.size || 0,
          mime: file.type || 'application/octet-stream',
          sha: result && result.content ? result.content.sha : '',
          createdAt: Date.now()
        };
        manifest.files = manifest.files.filter(function (item) { return item.path !== path; });
        manifest.files.unshift(entry);
        added.push(entry);
        if (typeof onProgress === 'function') onProgress(i + 1, files.length, name);
      }
      await flush('Update files manifest (' + added.length + ')');
      return added;
    } catch (error) {
      // 中途失败时把已上传成功的文件写进清单，避免出现“仓库有文件但列表没有”的孤儿。
      try {
        await flush('Update files manifest after partial upload (' + added.length + ')');
      } catch (flushError) {
        console.warn(flushError);
      }
      throw error;
    }
  }

  async function removeFile(cfg, entry) {
    var isLink = entry.external || String(entry.path || '').indexOf('link:') === 0;
    var existing = isLink ? null : await getFile(cfg, entry.path);
    var manifest = await readManifest(cfg);
    manifest.files = manifest.files.filter(function (item) { return item.path !== entry.path; });
    // 先更新清单，再删除文件：即使删除失败，访客也不会看到打不开的条目。
    await writeManifest(cfg, manifest, 'Remove ' + (entry.name || entry.path));
    if (existing) {
      await removeRemoteFile(cfg, entry.path, existing.sha, 'Delete ' + (entry.name || entry.path));
    }
  }

  async function addExternalLink(cfg, link) {
    var manifest = await readManifest(cfg);
    var entry = {
      name: link.name || '外部链接',
      url: link.url,
      external: true,
      path: 'link:' + link.url,
      createdAt: Date.now()
    };
    manifest.files = manifest.files.filter(function (item) { return item.path !== entry.path; });
    manifest.files.unshift(entry);
    await writeManifest(cfg, manifest, 'Add link ' + entry.name);
    return entry;
  }

  async function readMusic(cfg) {
    var file = await getFile(cfg, MUSIC_PATH);
    var manifest = { tracks: [], sha: file ? file.sha : '' };
    if (file) {
      try {
        var parsed = JSON.parse(base64ToUtf8(file.content));
        if (parsed && Array.isArray(parsed.tracks)) manifest.tracks = parsed.tracks;
      } catch (error) {
        throw new Error('public/music.json 格式不正确，请检查仓库中的文件');
      }
    }
    return manifest;
  }

  async function writeMusic(cfg, manifest, message) {
    var payload = {
      updatedAt: new Date().toISOString(),
      tracks: manifest.tracks
    };
    return putFile(cfg, MUSIC_PATH, utf8ToBase64(JSON.stringify(payload, null, 2)), message, manifest.sha);
  }

  async function publishTracks(cfg, records, onProgress) {
    var manifest = await readMusic(cfg);
    var added = [];
    function flush(message) {
      if (!added.length) return Promise.resolve(null);
      return writeMusic(cfg, manifest, message);
    }
    try {
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        var name = safeName(record.name || ((record.title || 'music') + '.mp3'));
        var path = MUSIC_DIR + name;
        var existing = await getFile(cfg, path);
        var base64 = await blobToBase64(record.blob);
        var result = await putFile(cfg, path, base64, 'Upload music ' + name, existing && existing.sha);
        var entry = {
          id: 'pub_' + Date.now() + '_' + i,
          title: record.title || name,
          artist: record.artist || '',
          name: name,
          path: path,
          url: path,
          size: record.size || (record.blob && record.blob.size) || 0,
          mime: record.mime || 'audio/mpeg',
          duration: record.duration || 0,
          createdAt: Date.now(),
          sha: result && result.content ? result.content.sha : ''
        };
        manifest.tracks = manifest.tracks.filter(function (item) { return item.path !== path; });
        manifest.tracks.unshift(entry);
        added.push(entry);
        if (typeof onProgress === 'function') onProgress(i + 1, records.length, name);
      }
      await flush('Update music manifest (' + added.length + ')');
      return added;
    } catch (error) {
      try {
        await flush('Update music manifest after partial upload (' + added.length + ')');
      } catch (flushError) {
        console.warn(flushError);
      }
      throw error;
    }
  }

  async function removeTrack(cfg, entry) {
    var path = entry.publicPath || entry.path;
    var manifest = await readMusic(cfg);
    manifest.tracks = manifest.tracks.filter(function (item) { return item.path !== path; });
    await writeMusic(cfg, manifest, 'Remove music ' + (entry.title || entry.name || path));
    if (path) {
      var existing = await getFile(cfg, path);
      if (existing) await removeRemoteFile(cfg, path, existing.sha, 'Delete music ' + (entry.title || path));
    }
  }


  async function readGallery(cfg) {
    var file = await getFile(cfg, GALLERY_PATH);
    var manifest = { photos: [], sha: file ? file.sha : '' };
    if (file) {
      try {
        var parsed = JSON.parse(base64ToUtf8(file.content));
        if (parsed && Array.isArray(parsed.photos)) manifest.photos = parsed.photos;
      } catch (error) {
        throw new Error('public/gallery.json 格式不正确，请检查仓库中的文件');
      }
    }
    return manifest;
  }

  async function writeGallery(cfg, manifest, message) {
    var payload = {
      updatedAt: new Date().toISOString(),
      photos: manifest.photos
    };
    return putFile(cfg, GALLERY_PATH, utf8ToBase64(JSON.stringify(payload, null, 2)), message, manifest.sha);
  }

  async function publishPhotos(cfg, records, onProgress) {
    var manifest = await readGallery(cfg);
    var added = [];
    function flush(message) {
      if (!added.length) return Promise.resolve(null);
      return writeGallery(cfg, manifest, message);
    }
    try {
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        var ext = String(record.name || '').toLowerCase().match(/\.[a-z0-9]+$/);
        var name = safeName(record.name || ('photo-' + Date.now() + (ext ? ext[0] : '.jpg')));
        var path = GALLERY_DIR + name;
        var existing = await getFile(cfg, path);
        var base64 = await blobToBase64(record.blob);
        var result = await putFile(cfg, path, base64, 'Upload photo ' + name, existing && existing.sha);
        var entry = {
          id: 'ph_' + Date.now() + '_' + i,
          title: record.title || name.replace(/\.[a-z0-9]+$/i, ''),
          caption: record.caption || '',
          name: name,
          path: path,
          url: path,
          size: record.size || (record.blob && record.blob.size) || 0,
          width: record.width || 0,
          height: record.height || 0,
          createdAt: Date.now(),
          sha: result && result.content ? result.content.sha : ''
        };
        manifest.photos = manifest.photos.filter(function (item) { return item.path !== path; });
        manifest.photos.unshift(entry);
        added.push(entry);
        if (typeof onProgress === 'function') onProgress(i + 1, records.length, name);
      }
      await flush('Update gallery manifest (' + added.length + ')');
      return added;
    } catch (error) {
      try {
        await flush('Update gallery manifest after partial upload (' + added.length + ')');
      } catch (flushError) {
        console.warn(flushError);
      }
      throw error;
    }
  }

  async function removePhoto(cfg, entry) {
    var path = entry.path || entry.publicPath;
    var manifest = await readGallery(cfg);
    manifest.photos = manifest.photos.filter(function (item) { return item.path !== path; });
    await writeGallery(cfg, manifest, 'Remove photo ' + (entry.caption || entry.name || path));
    if (path) {
      var existing = await getFile(cfg, path);
      if (existing) await removeRemoteFile(cfg, path, existing.sha, 'Delete photo ' + (entry.name || path));
    }
  }

  async function updatePhotoCaption(cfg, id, caption) {
    var manifest = await readGallery(cfg);
    var found = null;
    manifest.photos = manifest.photos.map(function (item) {
      if (item.id !== id) return item;
      found = Object.assign({}, item, { caption: String(caption || '').trim() });
      return found;
    });
    if (!found) throw new Error('找不到这张图片，请刷新页面');
    await writeGallery(cfg, manifest, 'Update photo caption');
    return found;
  }

  async function readLogs(cfg) {
    var file = await getFile(cfg, LOGS_PATH);
    var manifest = { logs: [], sha: file ? file.sha : '' };
    if (file) {
      try {
        var parsed = JSON.parse(base64ToUtf8(file.content));
        if (parsed && Array.isArray(parsed.logs)) manifest.logs = parsed.logs;
      } catch (error) {
        throw new Error('public/logs.json 格式不正确，请检查仓库中的文件');
      }
    }
    return manifest;
  }

  async function writeLogs(cfg, manifest, message) {
    var payload = {
      updatedAt: new Date().toISOString(),
      logs: manifest.logs
    };
    return putFile(cfg, LOGS_PATH, utf8ToBase64(JSON.stringify(payload, null, 2)), message, manifest.sha);
  }

  async function saveLog(cfg, log) {
    var manifest = await readLogs(cfg);
    var now = Date.now();
    var previous = null;
    manifest.logs.forEach(function (item) {
      if (item && item.id === (log.id || '')) previous = item;
    });
    var entry = {
      id: log.id || ('log_' + now),
      title: String(log.title || '无标题').trim().slice(0, 80),
      date: String(log.date || '').trim(),
      kind: String(log.kind || '随记').trim().slice(0, 12) || '随记',
      body: String(log.body || '').trim(),
      photos: (Array.isArray(log.photos) ? log.photos : []).filter(Boolean).slice(0, 9),
      views: Number(log.views) || 0,
      createdAt: log.createdAt || now,
      updatedAt: now
    };
    var replaced = false;
    manifest.logs = manifest.logs.map(function (item) {
      if (item.id !== entry.id) return item;
      replaced = true;
      return entry;
    });
    if (!replaced) manifest.logs.unshift(entry);
    await writeLogs(cfg, manifest, (replaced ? 'Update log ' : 'Add log ') + entry.title);
    /* 编辑时被移除的旧图，一并从仓库删掉 */
    if (previous) {
      var stale = (Array.isArray(previous.photos) ? previous.photos : []).filter(function (path) {
        return entry.photos.indexOf(path) === -1;
      });
      await deleteAssets(cfg, stale, 'public/logs/');
    }
    return entry;
  }

  /* 说说配图：存到 public/logs/<logId>/，返回可直接写进 logs.json 的路径数组 */
  async function uploadLogPhotos(cfg, logId, records, onProgress) {
    var paths = [];
    var folder = 'public/logs/' + safeName(logId || ('log_' + Date.now()));
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      var extMatch = String(record.name || '').toLowerCase().match(/\.[a-z0-9]+$/);
      var ext = extMatch ? extMatch[0] : '.jpg';
      var name = safeName('p' + (i + 1) + '-' + Date.now() + ext);
      var path = folder + '/' + name;
      var existing = await getFile(cfg, path);
      await putFile(cfg, path, await blobToBase64(record.blob), 'Upload log photo ' + name, existing && existing.sha);
      paths.push(path);
      if (typeof onProgress === 'function') onProgress(i + 1, records.length, path);
    }
    return paths;
  }

  async function removeLog(cfg, entry) {
    var manifest = await readLogs(cfg);
    var target = entry;
    manifest.logs.forEach(function (item) {
      if (item && item.id === entry.id) target = item;
    });
    manifest.logs = manifest.logs.filter(function (item) { return item.id !== entry.id; });
    await writeLogs(cfg, manifest, 'Remove log ' + (entry.title || entry.id));
    /* 说说自己的配图目录 public/logs/<id>/ 一起清掉 */
    var removed = await deleteAssets(cfg, target.photos, 'public/logs/');
    return removed;
  }

  /* ---- 测评：和 logs 一样存在 public/reviews.json，访客直接读这份文件 ---- */
  async function readReviews(cfg) {
    var file = await getFile(cfg, REVIEWS_PATH);
    var manifest = { reviews: [], sha: file ? file.sha : '' };
    if (file) {
      try {
        var parsed = JSON.parse(base64ToUtf8(file.content));
        if (parsed && Array.isArray(parsed.reviews)) manifest.reviews = parsed.reviews;
      } catch (error) {
        throw new Error('public/reviews.json 格式不正确，请检查仓库中的文件');
      }
    }
    return manifest;
  }

  async function writeReviews(cfg, manifest, message) {
    var payload = {
      updatedAt: new Date().toISOString(),
      reviews: manifest.reviews
    };
    return putFile(cfg, REVIEWS_PATH, utf8ToBase64(JSON.stringify(payload, null, 2)), message, manifest.sha);
  }

  function normalizeReview(review) {
    var now = Date.now();
    var score = Number(review.score);
    if (!isFinite(score)) score = 8;
    score = Math.min(10, Math.max(0, Math.round(score * 10) / 10));
    return {
      id: review.id || ('rv_' + now),
      title: String(review.title || '无标题').trim().slice(0, 80),
      category: review.category || 'game',
      categoryLabel: review.categoryLabel || '游戏',
      sub: String(review.sub || '').trim().slice(0, 60),
      score: score,
      cover: String(review.cover || '').trim(),
      text: String(review.text || '').trim(),
      images: Number(review.images) || 0,
      createdAt: review.createdAt || now,
      updatedAt: now
    };
  }

  async function saveReview(cfg, review) {
    var manifest = await readReviews(cfg);
    var entry = normalizeReview(review);
    var previous = null;
    manifest.reviews.forEach(function (item) {
      if (item && item.id === entry.id) previous = item;
    });
    var replaced = false;
    manifest.reviews = manifest.reviews.map(function (item) {
      if (item.id !== entry.id) return item;
      replaced = true;
      return Object.assign({}, entry, { createdAt: item.createdAt || entry.createdAt });
    });
    if (!replaced) manifest.reviews.unshift(entry);
    await writeReviews(cfg, manifest, (replaced ? 'Update review ' : 'Add review ') + entry.title);
    /* 换了封面就把旧的那张删掉，别留孤儿文件 */
    if (previous && previous.cover && previous.cover !== entry.cover) {
      await deleteAssets(cfg, [previous.cover], 'public/reviews/');
    }
    return entry;
  }

  async function removeReview(cfg, entry) {
    var manifest = await readReviews(cfg);
    var target = entry;
    manifest.reviews.forEach(function (item) {
      if (item && item.id === entry.id) target = item;
    });
    manifest.reviews = manifest.reviews.filter(function (item) { return item.id !== entry.id; });
    await writeReviews(cfg, manifest, 'Remove review ' + (entry.title || entry.id));
    /* 封面存在 public/reviews/ 下才删，手填的 gallery 链接不动 */
    var removed = await deleteAssets(cfg, [target.cover], 'public/reviews/');
    return removed;
  }

  /* 只换封面：写 public/cover.jpg，再把 site.json 的 cover 指过去 */
  async function publishCover(cfg, blob) {
    await uploadAsset(cfg, 'public/cover.jpg', blob, 'Publish cover');
    var file = await getFile(cfg, 'public/site.json');
    var site = {};
    if (file) {
      try {
        site = JSON.parse(base64ToUtf8(file.content)) || {};
      } catch (error) {
        site = {};
      }
    }
    site.cover = 'public/cover.jpg';
    site.updatedAt = new Date().toISOString();
    await putFile(cfg, 'public/site.json', utf8ToBase64(JSON.stringify(site, null, 2)), 'Publish cover', file && file.sha);
    return 'public/cover.jpg';
  }

  async function publishSite(cfg, site) {
    var existing = await getFile(cfg, 'public/site.json');
    return putFile(
      cfg,
      'public/site.json',
      utf8ToBase64(JSON.stringify(site, null, 2)),
      'Publish profile',
      existing && existing.sha
    );
  }

  async function uploadAsset(cfg, path, blob, message) {
    var existing = await getFile(cfg, path);
    return putFile(cfg, path, await blobToBase64(blob), message, existing && existing.sha);
  }

  async function test(cfg) {
    return request(cfg, '');
  }

  window.GitHubStore = {
    load: load,
    save: save,
    clear: clear,
    test: test,
    getFile: getFile,
    readManifest: readManifest,
    uploadFiles: uploadFiles,
    removeFile: removeFile,
    addExternalLink: addExternalLink,
    readMusic: readMusic,
    readGallery: readGallery,
    publishPhotos: publishPhotos,
    removePhoto: removePhoto,
    updatePhotoCaption: updatePhotoCaption,
    readLogs: readLogs,
    saveLog: saveLog,
    removeLog: removeLog,
    deleteAssets: deleteAssets,
    readReviews: readReviews,
    saveReview: saveReview,
    uploadLogPhotos: uploadLogPhotos,
    publishCover: publishCover,
    removeReview: removeReview,
    publishTracks: publishTracks,
    removeTrack: removeTrack,
    publishSite: publishSite,
    uploadAsset: uploadAsset,
    safeName: safeName,
    encodePath: encodePath
  };
})();
