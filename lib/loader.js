'use strict';

var _getIterator = require('babel-runtime/core-js/get-iterator')['default'];

var util = require('util');
var assume = require('assume');
var debug = require('debug')('taskcluster:loader');
var Promise = require('promise');
var _ = require('lodash');
var TopoSort = require('topo-sort');

// see babel issue 2215
function includes(a, v) {
  if (a.indexOf(v) === -1) {
    return false;
  }
  return true;
}

/** Validate component definition */
function validateComponent(def, name) {
  var e = "Invalid component definition: " + name;
  // Check that it's an object
  if (typeof def !== 'object' && def !== null && def !== undefined) {
    throw new Error(e + ' must be an object, null or undefined');
  }
  // Check that is object has a setup function
  if (!(def.setup instanceof Function)) {
    throw new Error(e + ' is missing setup function');
  }
  // If requires is defined, then we check that it's an array of strings
  if (def.requires) {
    if (!(def.requires instanceof Array)) {
      throw new Error(e + ' if present, requires must be array');
    }
    // Check that all entries in def.requires are strings
    if (!def.requires.every(function (entry) {
      return typeof entry === 'string';
    })) {
      throw new Error(e + ' all items in requires must be strings');
    }
  }
}

/**
 * Render componentDirectory to dot format for graphviz given a
 * topologically sorted list of components
 */
function renderGraph(componentDirectory, sortedComponents) {
  var dot = ['// This graph shows all dependencies for this loader.', '// You might find http://www.webgraphviz.com/ useful!', '', 'digraph G {'];

  var _iteratorNormalCompletion = true;
  var _didIteratorError = false;
  var _iteratorError = undefined;

  try {
    for (var _iterator = _getIterator(sortedComponents), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
      var component = _step.value;

      dot.push(util.format('  "%s"', component));
      var def = componentDirectory[component];
      var _iteratorNormalCompletion2 = true;
      var _didIteratorError2 = false;
      var _iteratorError2 = undefined;

      try {
        for (var _iterator2 = _getIterator(def.requires || []), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
          var dep = _step2.value;

          dot.push(util.format('  "%s" -> "%s" [dir=back]', component, dep));
        }
      } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion2 && _iterator2['return']) {
            _iterator2['return']();
          }
        } finally {
          if (_didIteratorError2) {
            throw _iteratorError2;
          }
        }
      }
    }
  } catch (err) {
    _didIteratorError = true;
    _iteratorError = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion && _iterator['return']) {
        _iterator['return']();
      }
    } finally {
      if (_didIteratorError) {
        throw _iteratorError;
      }
    }
  }

  dot.push('}');

  return dot.join('\n');
}

/*
 * Construct a component loader function.
 *
 * The `componentDirectory` is an object mapping from component names to
 * component loaders as follows:
 * ```js
 * let load = loader({
 *   // Component loader that always returns 'test'
 *   profile: {
 *     setup: () => 'test'
 *   },
 *
 *   // Component loader that requires profile as input to the setup function
 *   config: {
 *     requires: ['profile'],
 *     setup: (options) => {
 *       return base.config({profile: options.profile});
 *     }
 *   },
 *
 *   // Component loader that loads asynchronously
 *   requestedValue: {
 *     requires: ['config'],
 *     setup: async (options) => {
 *       let res = await request.get(config.some_url).get().end();
 *       return res.body;
 *     }
 *   },
 *
 *   // Component loader that requires more than one component
 *   server: {
 *     requires: ['config', 'requestedValue'],
 *     setup: (options) => {
 *       return server.startListening({
 *         config: options.config,
 *         input: options.requestedValues,
 *       });
 *     }
 *   }
 * });
 * ```
 * With this `load` function you can load the server using:
 * ```js
 * let server = await load('server');
 * ```
 * Naturally, you can also load config `await load('config');` which is useful
 * for testing.
 *
 * Sometimes it's not convenient to hard code constant values into the component
 * directory, in the example above someone might want to load the
 * components with a different profile. Instead you can specify "profile" as
 * a `virtualComponents`, then it must be provided as an options when loading.
 *
 * ```js
 * let load = loader({
 *   // Component loader that requires profile as input to the setup function
 *   config: {
 *     requires: ['profile'],
 *     setup: (options) => {
 *       return base.config({profile: options.profile});
 *     }
 *   }
 * }, ['profile']);
 * ```
 *
 * Then you'll be able to load config as:
 * ```js
 * let config = await load('config', {profile: 'test'});
 * ```
 */
function loader(componentDirectory) {
  var virtualComponents = arguments.length <= 1 || arguments[1] === undefined ? [] : arguments[1];

  assume(componentDirectory).is.an('object');
  assume(virtualComponents).is.an('array');
  assume(_.intersection(_.keys(componentDirectory), virtualComponents)).has.length(0);
  componentDirectory = _.clone(componentDirectory);

  // Check for undefined components
  _.forEach(componentDirectory, function (def, name) {
    validateComponent(def, name);
    var _iteratorNormalCompletion3 = true;
    var _didIteratorError3 = false;
    var _iteratorError3 = undefined;

    try {
      for (var _iterator3 = _getIterator(def.requires || []), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
        var dep = _step3.value;

        if (!componentDirectory[dep] && !includes(virtualComponents, dep)) {
          throw new Error('Cannot require undefined component: ' + dep);
        }
      }
    } catch (err) {
      _didIteratorError3 = true;
      _iteratorError3 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion3 && _iterator3['return']) {
          _iterator3['return']();
        }
      } finally {
        if (_didIteratorError3) {
          throw _iteratorError3;
        }
      }
    }
  });

  // Do topological sort to check for cycles
  var tsort = new TopoSort();
  _.forEach(componentDirectory, function (def, name) {
    tsort.add(name, def.requires || []);
  });
  var _iteratorNormalCompletion4 = true;
  var _didIteratorError4 = false;
  var _iteratorError4 = undefined;

  try {
    for (var _iterator4 = _getIterator(virtualComponents), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
      var _name = _step4.value;

      tsort.add(_name, []);
    }
  } catch (err) {
    _didIteratorError4 = true;
    _iteratorError4 = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion4 && _iterator4['return']) {
        _iterator4['return']();
      }
    } finally {
      if (_didIteratorError4) {
        throw _iteratorError4;
      }
    }
  }

  var topoSorted = tsort.sort();

  // Add graphviz target, if it doesn't exist, we'll just render it as string
  if (componentDirectory.graphviz || includes(virtualComponents, 'graphviz')) {
    throw new Error('graphviz is reserved for an internal component');
  }
  componentDirectory.graphviz = {
    setup: function setup() {
      return renderGraph(componentDirectory, topoSorted);
    }
  };

  return function (target) {
    var options = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

    options = _.clone(options);
    assume(target).is.a('string');
    // Check that all virtual components are defined
    assume(options).is.an('object');
    var _iteratorNormalCompletion5 = true;
    var _didIteratorError5 = false;
    var _iteratorError5 = undefined;

    try {
      for (var _iterator5 = _getIterator(virtualComponents), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
        var vComp = _step5.value;

        assume(options[vComp]).exists();
      }

      // Keep state of loaded components, make the virtual ones immediately loaded
    } catch (err) {
      _didIteratorError5 = true;
      _iteratorError5 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion5 && _iterator5['return']) {
          _iterator5['return']();
        }
      } finally {
        if (_didIteratorError5) {
          throw _iteratorError5;
        }
      }
    }

    var loaded = {};
    _.forEach(options, function (comp, key) {
      loaded[key] = Promise.resolve(comp);
    });

    // Load a component
    function load(target) {
      if (!loaded[target]) {
        var def = componentDirectory[target];
        // Initialize component, this won't cause an infinite loop because
        // we've already check that the componentDirectory is a DAG
        var requires = def.requires || [];
        return loaded[target] = Promise.all(requires.map(load)).then(function (deps) {
          var ctx = {};
          for (var i = 0; i < deps.length; i++) {
            ctx[def.requires[i]] = deps[i];
          }
          return def.setup.call(null, ctx);
        });
      }
      return loaded[target];
    };

    return load(target);
  };
};

// Export loader
module.exports = loader;
//# sourceMappingURL=loader.js.map