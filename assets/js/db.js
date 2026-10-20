/* ==========================================================================
   LibraryDB — tiny IndexedDB wrapper
   Stores: media (files / photos / audio / image assets), settings (single doc)
   ========================================================================== */
(function (global) {
  'use strict';

  var DB_NAME = 'atlas-library';
  var DB_VERSION = 1;
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in global)) {
        reject(new Error('当前浏览器不支持 IndexedDB'));
        return;
      }

      var request;
      try {
        request = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }

      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('media')) {
          var store = db.createObjectStore('media', { keyPath: 'id' });
          store.createIndex('kind', 'kind', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('无法打开本地数据库')); };
      request.onblocked = function () { reject(new Error('数据库被其他页面占用，请关闭其他标签页后重试')); };
    });

    return dbPromise;
  }

  function run(storeName, mode, action) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction;
        try {
          transaction = db.transaction(storeName, mode);
        } catch (err) {
          reject(err);
          return;
        }

        var store = transaction.objectStore(storeName);
        var result;

        try {
          result = action(store);
        } catch (err) {
          reject(err);
          try { transaction.abort(); } catch (e) { /* noop */ }
          return;
        }

        transaction.oncomplete = function () {
          if (result && typeof result === 'object' && 'result' in result) {
            resolve(result.result);
          } else {
            resolve(result);
          }
        };
        transaction.onerror = function () {
          reject(transaction.error || new Error('本地存储操作失败'));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error('本地存储操作被中止'));
        };
      });
    });
  }

  function init() {
    return openDB().then(function () { return true; });
  }

  function getSettings() {
    return run('settings', 'readonly', function (store) {
      return store.get('app');
    }).then(function (record) {
      return record ? record.value : null;
    });
  }

  function saveSettings(value) {
    return run('settings', 'readwrite', function (store) {
      return store.put({ key: 'app', value: value });
    }).then(function () { return value; });
  }

  function listMedia(kind) {
    return run('media', 'readonly', function (store) {
      return store.index('kind').getAll(kind);
    }).then(function (list) { return list || []; });
  }

  function getAllMedia() {
    return run('media', 'readonly', function (store) {
      return store.getAll();
    }).then(function (list) { return list || []; });
  }

  function getMedia(id) {
    return run('media', 'readonly', function (store) {
      return store.get(id);
    });
  }

  function putMedia(record) {
    return run('media', 'readwrite', function (store) {
      return store.put(record);
    }).then(function () { return record; });
  }

  function deleteMedia(id) {
    return run('media', 'readwrite', function (store) {
      return store.delete(id);
    });
  }

  function clearMedia() {
    return run('media', 'readwrite', function (store) {
      return store.clear();
    });
  }

  function estimate() {
    if (global.navigator && navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  global.LibraryDB = {
    init: init,
    getSettings: getSettings,
    saveSettings: saveSettings,
    listMedia: listMedia,
    getAllMedia: getAllMedia,
    getMedia: getMedia,
    putMedia: putMedia,
    deleteMedia: deleteMedia,
    clearMedia: clearMedia,
    estimate: estimate
  };
})(window);
