var _ = require('lodash');
var async = require('async');
var fs = require('fs');

module.exports = factory;

function factory(options, callback) {
  return new Construct(options, callback);
}

function Construct(options, callback) {
  var self = this;

  self._apos = options.apos;
  self._pages = options.pages;

  self._apos.on('tasks:register', function(taskGroups) {
    taskGroups.apostrophe.applyPatch = function(site, apos, argv, callback) {
      var file = argv._[1];
      if (!file) {
        return callback('Usage: node app apostrophe:apply-patch patchfile.json');
      }
      var patch;
      try {
        patch = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        console.error(e);
        return callback('An error occurred opening the patch file ' + argv._[1] + ', is this a valid A2 json patchfile?');
      }
      if (!patch.type) {
        return callback('This file contains JSON but it is not a valid A2 patchfile, I do not see a type property.');
      }
      if (patch.type !== 'a2Patch1') {
        return callback('type property is ' + patch.type + ', right now I only support a2Patch1, giving up on this file');
      }
      var collections = patch.collections;
      var req = self._apos.getTaskReq();
      return async.eachSeries(_.keys(collections), function(name, callback) {
        var collectionPatch = collections[name];
        return self._apos.db.collection(name, {}, function(err, collection) {
          if (err) {
            return callback(err);
          }
          return async.eachSeries(collectionPatch.changes, function(item, callback) {
            if (item.insert) {
              if (name !== 'aposPages') {
                // Other collections are simple, almost
                var options = item.options || {};
                if (options.ifNew) {
                  // Insert only if id is not present.
                  // Avoids duplicate key errors when merging
                  // folders of pages that utilize some of
                  // the same media and build IDs for it in
                  // the same way
                  return async.eachSeries(item.insert, function(item, callback) {
                    return collection.findOne({ _id: item._id }, function(err, exists) {
                      if (err) {
                        return callback(err);
                      }
                      if (exists) {
                        return callback(null);
                      }
                      return collection.insert(item, callback);
                    });
                  }, callback);
                }
                // Truly simple
                return collection.insert(item.insert, callback);
              }
              // pages require some special cases
              return async.eachSeries(item.insert, function(item, callback) {
                console.log(item.path);
                // putPage will treat it as an old page
                // if it has an _id, but if we supply
                // a _newId that will be used and putPage
                // will not generate one for us randomly
                item._newId = item._id;
                delete item._id;

                // Implement special cases, then insert
                return async.series({
                  nextRank: function(callback) {
                    var parent;
                    if (!item.slug.match(/^\//)) {
                      // Not in tree, no rank needed
                      return setImmediate(callback);
                    }
                    var parentPath = item.path.replace(/\/[^\/]*$/, '');
                    return self._apos.pages.findOne({ path: parentPath }, function(err, _parent) {
                      if (err) {
                        return callback(err);
                      }
                      if (!_parent) {
                        return callback("Unable to insert a child page with the path " + item.path + " because no parent page has the path " + parentPath);
                      }
                      parent = _parent;
                      return self._pages.getNextRank(parent, function(err, rank) {
                        if (err) {
                          return callback(err);
                        }
                        item.rank = rank;
                        return callback(null);
                      });
                    });
                  },
                  findOrCreatePerson: function(callback) {
                    var candidates = _.filter(_.keys(item), function(key) {
                      return key.match(/id$/i);
                    });
                    return async.eachSeries(candidates, function(key, callback) {
                      var matches = item[key].match(/^\$findOrCreatePerson\:(.*)$/);
                      if (!matches) {
                        return setImmediate(callback);
                      }
                      var json = matches[1];
                      var info = JSON.parse(json);
                      var person;
                      return async.series({
                        find: function(callback) {
                          var clauses = [];
                          if (info.username) {
                            clauses.push({ username: info.username });
                          }
                          if (info.email) {
                            clauses.push({ email: info.email });
                          }
                          if (!clauses.length) {
                            return setImmediate(callback);
                          }
                          return apos.pages.findOne({
                            type: 'person',
                            $or: clauses
                          }, function(err, _person) {
                            if (err) {
                              return callback(err);
                            }
                            person = _person;
                            return callback(null);
                          });
                        },
                        create: function(callback) {
                          if (person) {
                            return setImmediate(callback);
                          }
                          person = info;
                          return apos.pages.insert(person, callback);
                        },
                        replace: function(callback) {
                          item[key] = person._id;
                          return setImmediate(callback);
                        }
                      }, callback);
                    }, callback);
                  },
                  insert: function(callback) {
                    return self._apos.putPage(req, item.slug, item, function(err) {
                      return callback(err);
                    });
                  }
                }, callback);
              }, callback);
            }
            if (item.update) {
              // For now updates are always single. We get
              // a fatal error from mongo if we try to use
              // multi when $ operators are not present, and
              // we don't have a need for multi so far in
              // our patchfiles.
              return collection.update(item.update.criteria, item.update.command, callback);
            }
            if (item.remove) {
              if (!item.remove.criteria) {
                return callback('No criteria object in remove object: ' + JSON.stringify(item));
              }
              return collection.remove(item.remove.criteria, callback);
            }
            return callback("Unrecognized change type in collection: " + JSON.stringify(item));
          }, callback);
        });
      }, callback);
    };
  });

  // Invoke the callback. This must happen on next tick or later!
  return process.nextTick(function() {
    return callback(null);
  });
}

// Export the constructor so others can subclass
factory.Construct = Construct;

