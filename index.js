var JSONStream = require('JSONStream');
var duplexer = require('duplexer');
var through = require('through');
var uglify = require('uglify-js');

var fs = require('fs');
var path = require('path');

var combineSourceMap = require('combine-source-map');

var prelude = (function () {
    var src = fs.readFileSync(path.join(__dirname, 'prelude.js'), 'utf8');
    return uglify(src) + '({';
})();

function newlinesIn(src) {
  if (!src) return 0;
  var newlines = src.match(/\n/g);

  return newlines ? newlines.length : 0;
}

module.exports = function (opts) {
    if (!opts) opts = {};
    var parser = opts.raw ? through() : JSONStream.parse([ true ]);
    var output = through(write, end);
    parser.pipe(output);
    
    var first = true;
    var entries = [];
    var order = [];

    var allFilepaths = [], filenameMap = {};
    
    var lineno = 1 + newlinesIn(prelude);
    var sourcemap;

    return duplexer(parser, output);
    
    function write (row) {
        if (first) this.queue(prelude);
        
        if (row.sourceFile) { 
            sourcemap = sourcemap || combineSourceMap.create();
            sourcemap.addFile(
                { sourceFile: row.sourceFile, source: row.source },
                { line: lineno }
            );
        }
        allFilepaths.push(filenameMap[row.id] = (row.filename || row.sourceFile || row.id).replace(/\\/g, '/'));
        
        var wrappedSource = [
            (first ? '' : ','),
            JSON.stringify(row.id),
            ':[',
            'function(require,module,exports){\n',
            combineSourceMap.removeComments(row.source),
            '\n},',
            JSON.stringify(row.deps || {}),
            ']'
        ].join('');

        this.queue(wrappedSource);
        lineno += newlinesIn(wrappedSource);
        
        first = false;
        if (row.entry && row.order !== undefined) {
            entries[row.order] = row.id;
        }
        else if (row.entry) entries.push(row.id);
    }
    
    function end () {
        if (first) this.queue(prelude);
        entries = entries.filter(function (x) { return x !== undefined });

        this.queue('},{},' + JSON.stringify(entries));
        if (!allFilepaths.length) {
            this.queue('{}');
        } else {
            // Find the Lowest Common Ancestor (O(depth * count))
            // Always include at least the parent directory name.
            var dirnameSplits = allFilepaths.map(function (p) { return path.dirname(path.dirname(p)).split('/'); });
            var commonLength = 0;
            for (var i = 0; i < dirnameSplits[0].length; i++) {
                if (dirnameSplits.some(function (parts) { return parts[i] !== dirnameSplits[0][i]; }))
                    break;      // If some of the paths are different at this part, stop.

                commonLength += dirnameSplits[0][i].length;
                if (i) commonLength++;  // Count the separator too
            }

            for (var id in filenameMap) 
                filenameMap[id] = filenameMap[id].slice(commonLength);

            this.queue(',' + JSON.stringify(filenameMap));
        }
        
        this.queue(')');
        if (sourcemap) this.queue('\n' + sourcemap.comment());

        this.queue(null);
    }
};
