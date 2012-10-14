﻿;
goog.provide('pn.data.LocalCache');

goog.require('goog.Disposable');
goog.require('goog.array');
goog.require('pn.data.BaseDalCache');
goog.require('pn.data.LinqParser');
goog.require('pn.data.Query');
goog.require('pn.json');
goog.require('pn.log');



/**
 * @constructor
 * @extends {goog.Disposable}
 * @param {string} dbver The current db version.
 * @param {string=} opt_cachePrefix An optional prefix to use for all
 *    read/writes from/to the local cache.
 */
pn.data.LocalCache = function(dbver, opt_cachePrefix) {
  goog.Disposable.call(this);
  if (!window['localStorage'])
    throw new Error('The current browser is not supported');

  /**
   * @private
   * @type {goog.debug.Logger}
   */
  this.log_ = pn.log.getLogger('pn.data.LocalCache', false);

  /**
   * @private
   * @type {number}
   */
  this.lastUpdate_ = 0;

  /**
   * @private
   * @const
   * @type {string}
   */
  this.STORE_PREFIX_ = (opt_cachePrefix ?
      opt_cachePrefix : '' + 'LOCAL_DATA_CACHE:');

  /**
   * @private
   * @type {!Object.<string, !Array.<pn.data.Entity>>}
   */
  this.cache_ = {};

  /**
   * @private
   * @type {!Object.<!pn.data.Query>}
   */
  this.cachedQueries_ = [];

  this.checkDbVer_(dbver);
  this.init_();
};
goog.inherits(pn.data.LocalCache, goog.Disposable);


/**
 * Gets an entity from the local cache.  If this entity does not exist in the
 *    client cache then an error is thrown.
 *
 * @param {string} type The type of entity to query.
 * @param {number} id The ID of the entity to retreive.
 * @return {!pn.data.Entity} The entity with the specified id.
 */
pn.data.LocalCache.prototype.getEntity = function(type, id) {
  pn.assStr(type);
  pn.ass(type in this.cache_, type + ' not in cache');
  pn.ass(goog.isNumber(id) && id !== 0);

  var en = this.cache_[type].pnsingle(function(entity) {
    return entity.id === id;
  }, this);
  return en;
};


/**
 * TODO: When creating a new entity it is now detached form this cache.  This
 * method should return the created entity so it is 'live'.
 *
 * Creates a local entity with a temporary ID.
 * @param {!pn.data.Entity} entity The entity to create.  Since this is an
 *    instance of a new data.Entity its ID should be 0 until a temp ID is
 *    assigned here.
 * @return {!pn.data.Entity} The same entity is returned but its ID property
 *    is now set to the temporary ID and the entity is 'live'.
 */
pn.data.LocalCache.prototype.createEntity = function(entity) {
  pn.ass(entity instanceof pn.data.Entity);
  pn.ass(entity.type in this.cache_,
      entity.type + ' not in cache');
  pn.ass(entity.id < 0);
  this.cache_[entity.type].push(entity);
  this.flush_(entity.type);

  return entity;
};


/**
 * Updates a local entity with an optional temporary ID.
 * @param {!pn.data.Entity} entity The entity to update.
 * @param {number=} opt_tmpid The optional temporary ID if we need to update
 *    an entity that has not hit the server yet.
 */
pn.data.LocalCache.prototype.updateEntity = function(entity, opt_tmpid) {
  pn.ass(entity instanceof pn.data.Entity);
  pn.ass(!goog.isDef(opt_tmpid) ||
      (goog.isNumber(opt_tmpid) && opt_tmpid < 0));

  var id = opt_tmpid || entity.id;
  var list = this.cache_[entity.type];
  var found = false;
  for (var i = 0, len = list.length; i < len; i++) {
    var e = list[i];
    if (e.id === id) { list[i] = entity; found = true; break; }
  }
  if (!found) throw new Error('Could not find entity: ' +
      entity.type + '.' + entity.id + ' in the cache.');

  // entity.update(); // TODO: fire live entity changed

  this.flush_(entity.type);
};


/**
 * Deletes a local entity .
 * @param {!string} type The type of the entity to delete.
 * @param {number} id The ID of the entity to delete.
 */
pn.data.LocalCache.prototype.deleteEntity = function(type, id) {
  pn.assStr(type);
  pn.ass(type in this.cache_, type + ' not in cache');
  pn.ass(goog.isNumber(id) && id !== 0);

  // var live = this.getEntity(type, id);
  // live.delete(); // TODO: fire live entity deleted

  this.cache_[type] = this.cache_[type].pnfilter(
      function(e) { return e.id !== id; });
  this.flush_(type);
};


/**
 * If there is an issue deleting an entity on the server then call this to
 *    revert the delete operation.  This basically recreates the entity.
 * @param {!pn.data.Entity} entity The entity to undelete.
 */
pn.data.LocalCache.prototype.undeleteEntity = function(entity) {
  pn.ass(entity instanceof pn.data.Entity);
  pn.ass(entity.id > 0);

  if (!(entity.type in this.cache_)) this.cache_[entity.type] = [];
  var entities = this.cache_[entity.type];
  // If this entity already exists in cache (was added locally) then we can
  // just update it.
  var idx = entities.pnfindIndex(function(e2) {
    return e2.id === entity.id;
  });
  if (idx < 0) idx = entities.length;
  entities[idx] = entity;
  this.flush_(entity.type);
};


/**
 * Wether this cache has the specified type primed.
 * @param {!pn.data.Query} query The query type to check.
 * @return {boolean} Wether the specified type list exists in this cache.
 */
pn.data.LocalCache.prototype.contains = function(query) {
  pn.ass(query instanceof pn.data.Query);
  return (query.Type in this.cache_);
};


/**
 * @param {!Array.<pn.data.Query>} queries The queries to execute.
 * @return {!Object.<!Array.<pn.data.Entity>>} The query results.
 */
pn.data.LocalCache.prototype.query = function(queries) {
  return queries.pnreduce(goog.bind(function(results, q) {
    pn.ass(q instanceof pn.data.Query);

    pn.ass(q.Type in this.cache_, 'The type: ' + q.Type +
        ' does not exist in the local cache');

    var list = this.cache_[q.Type];
    if (q.Linq) {
      var filter = pn.data.LinqParser.parse(q.Linq);
      list = filter(list);
    }
    results[q.toString()] = list;
    return results;
  }, this), {});
};


/** @return {!Array.<!pn.data.Query>} The cached queries. */
pn.data.LocalCache.prototype.getCachedQueries = function() {
  return goog.object.getValues(this.cachedQueries_);
};


/**
 * @param {pn.data.Query} query The query to save.
 * @param {!Array.<pn.data.Entity>} list The list of entities to save against
 *    the specified type.
 */
pn.data.LocalCache.prototype.saveQuery = function(query, list) {
  pn.ass(query instanceof pn.data.Query);
  pn.assArr(list);

  var type = query.Type;
  var current = this.cache_[type];
  if (current) {
    // TODO: Instead of just 'Union'ing the lists we should actually update
    // any entity that needs updates.
    var existing = current.pnfilter(function(e) {
      return list.pnfindIndex(function(newe) {
        return newe.id === e.id;
      }) < 0;
    });
    list = list.pnconcat(existing);
  }
  this.cache_[type] = list;
  var qid = query.toString();
  this.cachedQueries_[qid] = query;
  this.flush_(type);
  this.flushCachedQueries_();
};


/** @return {number} The last updated date in millis. */
pn.data.LocalCache.prototype.getLastUpdate = function() {
  return this.lastUpdate_;
};


/** @param {number} lastUpdate The last updated date in millis. */
pn.data.LocalCache.prototype.setLastUpdate = function(lastUpdate) {
  this.lastUpdate_ = lastUpdate;
  window['localStorage'][this.STORE_PREFIX_ + 'last'] = lastUpdate.toString();
};


/**
 * @private
 * @param {string} dbver The current db version. If this version does not
 *    match the current cached version then the entire local cache is
 *    invalidated.
 */
pn.data.LocalCache.prototype.checkDbVer_ = function(dbver) {
  var exp = window['localStorage'][this.STORE_PREFIX_ + 'dbver'];
  window['localStorage'][this.STORE_PREFIX_ + 'dbver'] = dbver;
  if (!dbver || !exp || dbver === exp) return;

  this.log_.info('Clearing the LocalCache. Version mismatch [%s] != [%s]'.
      pnsubs(exp, dbver));

  this.clear();
};


/**
 * Clears the local cache.
 */
pn.data.LocalCache.prototype.clear = function() {
  this.lastUpdate_ = 0;
  for (var key in window['localStorage']) {
    if (goog.string.startsWith(key, this.STORE_PREFIX_)) {
      delete window['localStorage'][key];
    }
  }
};


/** @private */
pn.data.LocalCache.prototype.init_ = function() {
  var cachedtime = window['localStorage'][this.STORE_PREFIX_ + 'last'];
  this.lastUpdate_ = cachedtime ? parseInt(cachedtime, 10) : 0;

  var queriesJson = window['localStorage'][this.STORE_PREFIX_ + 'queries'];
  if (queriesJson) {
    var arr = /** @type {!Array.<string>} */ (pn.json.parseJson(queriesJson));
    this.cachedQueries_ = arr.pnreduce(function(acc, qstr) {
      var query = pn.data.Query.fromString(qstr);
      acc[qstr] = query;
      return acc;
    }, {});
  } else { this.cachedQueries_ = {}; }
  var parse = goog.bind(function(type) {
    return pn.json.parseJson(window['localStorage'][this.STORE_PREFIX_ + type]);
  }, this);

  if (!queriesJson) {
    if (this.lastUpdate_ > 0) {
      var err = 'Last update time is set (%s) but the cache is empty.'.
          pnsubs(this.lastUpdate_);
      throw new Error(err);
    }
    this.cache_ = {};
    return;
  }

  this.cache_ = {};
  var queriesToRemove = [];
  for (var qid in this.cachedQueries_) {
    var query = pn.data.Query.fromString(qid);

    var rawList = parse(query.Type);
    if (!goog.isDef(rawList)) {
      queriesToRemove.push(qid);
      continue;
    }

    pn.assArr(rawList);

    var list = pn.data.TypeRegister.parseEntities(query.Type, rawList);
    this.cache_[query.Type] = list;
  }
  queriesToRemove.pnforEach(function(qid) {
    delete this.cachedQueries_[qid];
  }, this);
};


/**
 * @private
 * @param {string} type The type (cache key) to flush to disk.
 */
pn.data.LocalCache.prototype.flush_ = function(type) {
  pn.assStr(type);
  pn.ass(type in this.cache_, type + ' not in cache');
  this.log_.info('Flushing "%s".'.pnsubs(type));

  var list = this.cache_[type];
  // Using JSON.stringify for performance as we will handle dates in the toJson
  // method.
  var json = JSON.stringify(list.pnmap(
      function(e) { return e.toJson(); }), true);
  window['localStorage'][this.STORE_PREFIX_ + type] = json;
};


/** @private */
pn.data.LocalCache.prototype.flushCachedQueries_ = function() {
  var json = pn.json.serialiseJson(goog.object.getKeys(this.cachedQueries_));
  window['localStorage'][this.STORE_PREFIX_ + 'queries'] = json;
};
