var exec = require('child_process').exec;
var fse  = require('fs-extra');
var mime    = require("mime");
var d3TimeFormat = require('d3-time-format');
var commitFormatter = d3TimeFormat.timeFormat("%x - %H:%M");
var path  = require('path');
var url  = require('url');
var optimist = require("optimist");
var CommandQueue = require("command-queue");

var argv = optimist.usage("Usage: $0")
  .options("h", {
    alias: "help",
    describe: "display this help text"
  })
  .options("repositories", {
    describe: "git repositories"
  })
  .options("data", {
    describe: "where the repository metadata lives",
  })
  .options("port", {
    default: 3003,
    describe: "http port"
  })
  .options("baseURL", {
    describe: "base url for the app to work from"
  })
  .options("screenshots", {
    default: "",
    describe: "static screenshot directory path"
  })
  .options("cloneURL", {
    describe: "public facing root git repository url",
    default: ""
  })    
    // .check(function(argv) {
    //   if (argv.help) throw "";
    //   try { var stats = fs.statSync(argv.repository); } catch (e) { throw "Error: " + e.message; };
    // })
  .argv;

var DATA_PATH = (argv.data) ? path.resolve(__dirname, argv.data) : path.resolve(__dirname, "../data");;
var BASE_URL = (argv.baseURL) ? argv.baseURL : "";
var CLONE_URL = argv.cloneURL;
var PORT = argv.port;
var SCREENSHOTS_PATH = (argv.screenshots) ? path.resolve(argv.screenshots) : path.resolve(__dirname, "../", "static","screenshots");
var REPO_PATH = (argv.repositories) ? path.resolve(argv.repositories) : path.resolve(__dirname, "../", "repositories");
var TMP_PATH = path.resolve(__dirname, "../", "tmp");
var MobileDetect = require('mobile-detect');

var SketchController = require('../server/SketchController.js')(DATA_PATH);
var express = require('express');
var app = express();
app.enable('strict routing');

var gitController = require('../server/GitController.js');
app.use(express.static('static'));


/* start basic setup for handling */
var bodyParser = require('body-parser');
var methodOverride = require('method-override');
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies
app.use(bodyParser.json()); // support json encoded bodies
app.use(methodOverride());
app.set('view engine', 'ejs');
require('express-helpers')(app);

var slugify = require('./utils/slugify.js');

// borrowed from mbostock
function mimeType(file) {
  var type = mime.getType(file);
  return text(type) ? type + "; charset=utf-8" : type;
}

function text(type) {
  return /^(text\/)|(application\/(javascript|json)|image\/svg$)/.test(type);
}

function logErrors (err, req, res, next) {
  console.error(err.stack);
  next(err);
};
function clientErrorHandler (err, req, res, next) {
  if (req.xhr) {
    res.status(500).send({ error: 'Something failed!' });
  } else {
    next(err);
  }
};
function errorHandler (err, req, res, next) {
  res.status(500);
  res.render('error', { error: err });
};
/* end basic setup for handling */

app.use(logErrors);
app.use(clientErrorHandler);
app.use(errorHandler);

// define the home page route
app.get('/', function(req, res) {
  var sketches = SketchController.get().filter(function(sketch){ return sketch.status > 0; });
  if(!sketches){
    res.send('sketches list is empty');
  }else{
    if(req.xhr){
      res.json(JSON.stringify(sketches));
    }else{
      res.render('sketches', { BASE_URL: BASE_URL, sketches: sketches, active: 'sketches', hed: 'Active Projects' });
    }
  }
});


app.post(`/create/submit`, function(req, res) {
  var name  = req.body.name || `default-${id}`,
    description = req.body.description || "",
    tags  = req.body.tags || "",
    team  = req.body.team || null,
    slug  = slugify(name),
    type  = req.body.type || "web",
    template = req.body.template || "blank",
    screenshots = (req.body.screenshots) ? true : false,
    repoPath = (req.body.template === 'existing') ? 
      req.body.repoPath : path.resolve(REPO_PATH, `${slug}.git`);

  var sketch = {
    name: name,
    description: description,
    tags: tags,
    team: team,
    status: 1,
    created: Date.now(),
    slug: slug,
    path: repoPath,
    type: type, 
    screenshots: screenshots,
    template: template
  };
  
  gitController.createSketch(sketch)
    .then(function(result){
      SketchController.create(sketch);

      if(req.xhr){
        return res.json(JSON.stringify(sketches));
      }else{
        res.redirect(`/`);
      }  
    }).catch(function(result){
      res.status(500).send("error, cant make sketch");
    });
});


// app.get(`${BASE_URL}/sketches`, function(req, res) {
//   var sketches = SketchController.get().filter(function(sketch){ return sketch.status > 0; });
//   if(!sketches){
//     res.send('sketches list is empty');
//   }else{
//     if(req.xhr){
//       res.json(JSON.stringify(sketches));
//     }else{
//       res.render('sketches', { BASE_URL: BASE_URL, sketches: sketches, active: 'sketches', hed: 'Active Projects'  });
//     }
//   }
// });

app.get(`/archived`, function(req, res) {
  var sketches = SketchController.get().filter(function(sketch){ return sketch.status < 1; });
  if(!sketches){
    res.send('sketches list is empty');
  }else{
    if(req.xhr){
      res.json(JSON.stringify(sketches));
    }else{
      res.render('archived', { BASE_URL: BASE_URL, sketches: sketches, active: 'archived', hed: 'Archived Projects'  });
    }
  }
});


var executeQueue = function(tasks){
  var onSuccess = function(){
    if(tasks.length > 0){
      
      new CommandQueue()
        .sync(tasks[0])
        .run()
        .then(onSuccess, onFail);

      console.log('successfully executed ', tasks[0], ' commands');
      tasks.shift();
    }    
    
  };
  var onFail = function(){
    console.log('failure');
    // Close any remaining commands.
    queue.close();
  };

  onSuccess();

};


// regnerate screenshots for a repo
app.get(`/tasks/regenerate/:slug`, function(req, res) {
  var sketch = SketchController.get(req.params.slug);
  if(!sketch){
    res.status(404).send("error, sketch doesnt exist");
  }else{
    gitController.getCommitsAndRefs(`${sketch.path}`)
      .then(function(result){
        res.sendStatus(200);
        console.log('proceeding to jobs');

        var tasks = result.commits.map(function(commit, i){
          var writeLatest = (i === tasks.length - 1) ? ' true' : '';
          return `node ${path.resolve( __dirname, "hooks.js")} ${sketch.slug} ${commit.sha()}${writeLatest}`;
        });

        executeQueue(tasks);
        
      })
      
      .catch(function(err){
        console.log(err)
        res.status(500).send('error opening!', err);
      });
  }
});


app.get(`/sketches/:slug`, function(req, res) {
  var sketch = SketchController.get(req.params.slug);
  if(!sketch){
    res.status(404).send("error, sketch doesnt exist");
  }else{
    gitController.getCommitsAndRefs(`${sketch.path}`)
      .then(function(result){
        sketch.commits = result.commits;
        sketch.repository = result.repository;
        sketch.references = result.references;
        md = new MobileDetect(req.headers['user-agent']);
        console.log(result)
        res.render('sketch', { 
          sketch: sketch, 
          active: 'sketches', 
          BASE_URL: BASE_URL,
          cloneURL: url.resolve(CLONE_URL, sketch.path.split('/').slice(-1)[0]), 
          commitFormatter: commitFormatter, md: md 
        });
      })
      .catch(function(err){
        console.log(err)
        res.status(500).send('error opening!', err);
      });
  }
});


app.post(`/sketches/:slug/update`, function(req, res) {
  // if(!sketch){
  //   res.status(404).send("error, sketch doesnt exist");
  // }else{
  // console.log('====>',req.body)
  SketchController.update(req.params.slug, req.body);
  // }
  res.sendStatus(200)
});


app.get(`/view/:slug/latest`, function(req, res) {
  res.redirect(`/view/${req.params.slug}/latest/`);
});

app.get(`/view/:slug/:branch/latest/*?`, function(req, res) {
  var revision  = `branch=${req.params.branch}`,
      path      = (!req.params[0]) ? 'index.html' : req.params[0];
    
  var slug      = req.params.slug;
  var sketch    = SketchController.get(slug);

  if(sketch){
    console.log('tryingt to get:', sketch.path)
    gitController.getFile(sketch.path, revision, path).then(function(blob){
      res.set('Content-Type', mimeType(path));
      res.send(blob.content());
    }).catch(function(err){
      console.log(err);
    });
  }else{
    res.send(`couldnt find ${slug} file`);  
  }
});

app.get(`/view/:slug/:commit/*?`, function(req, res) {
  var commit    = req.params.commit,
      path      = (!req.params[0]) ? 'index.html' : req.params[0];
    
  var slug      = req.params.slug;
  var sketch    = SketchController.get(slug);

  if(sketch){
    
    gitController.getFile(sketch.path, commit, path).then(function(blob){
      res.set('Content-Type', mimeType(path));
      res.send(blob.content());
    });
  }else{
    res.send(`couldnt find ${slug} file`);  
  }
  
});


// assuming success on any of this is obv a TODO
app.get(`/sketches/:slug/archive`, function(req, res) {
  SketchController.archive(req.params.slug);
  res.json({ success: true });
});

app.get(`/sketches/:slug/delete`, function(req, res) {
  SketchController.delete(req.params.slug);
  res.json({ success: true });
});

app.get(`/sketches/:slug/activate`, function(req, res) {
  SketchController.activate(req.params.slug);
  res.json({ success: true });
});


// write out start settings for hook scripts
fse.writeFileSync(path.resolve(TMP_PATH, 'SETTINGS.json'), JSON.stringify({ 
  port: PORT, 
  data: DATA_PATH, 
  repositories: REPO_PATH, 
  tmp: TMP_PATH,
  screenshots: SCREENSHOTS_PATH
})); 


app.listen(PORT, function () {
  console.log(`Sketch server is listening on ${PORT} prefixed by ${BASE_URL}`);
});