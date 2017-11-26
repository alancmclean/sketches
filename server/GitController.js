var NodeGit = require("nodegit");
var path    = require("path");
var fse     = require('fs-extra-promise');
var child = require('child_process');
var GitController = {};

var HOOKS_PATH = path.resolve(__dirname, "../hooks");
var REPO_PATH = path.resolve(__dirname, "../repository");
var TMP_PATH = path.resolve(__dirname, "../tmp");
var TEMPLATE_PATH = path.resolve(__dirname, "../templates");
var SCREENSHOTS_PATH = path.resolve(__dirname, "../static/screenshots");
var SCRIPTS_PATH = path.resolve( __dirname, "../bin/","hooks.js");

GitController.importRepository = function(sketch, repository){
  var src   = path.resolve(HOOKS_PATH, 'post-receive');
  var dest  = path.resolve(repository.path(), 'hooks/post-receive');
  fse.copySync(src, dest);
  fse.mkdirsSync(path.resolve(SCREENSHOTS_PATH, sketch.slug));
};

GitController.initalCommitHack = function(sketch, repository){
  var tmpPath = path.resolve(TMP_PATH, sketch.slug),
    oid,
    index,
    remote,
    tmpRepo,
    paths;

  // remove the trailing /
  NodeGit.Clone(repository.path().slice(0, -1), tmpPath)
    .then(function(repo){ 
      tmpRepo = repo;
      if(sketch.screenshots){
        var src   = path.resolve(HOOKS_PATH, 'post-receive');
        var dest  = path.resolve(repository.path(), 'hooks/post-receive');
        fse.copySync(src, dest);
        fse.mkdirsSync(path.resolve(SCREENSHOTS_PATH, sketch.slug));
        return repo;
      }else{
        console.log('screenshots disabled');
        return repo
      }
    })
    .then(function(repo){
      var src   = path.resolve(TEMPLATE_PATH, sketch.template);
      var dest  = path.resolve(tmpPath);
      fse.copySync(src, dest);
      return tmpRepo;
    })    
    .then(function() {
      return tmpRepo.refreshIndex();
    })    
    .then(function(indexResult){
      index = indexResult;
      return tmpRepo.getStatusExt();
    })
    .then(function(statuses) {
      // console.log('status', statuses)
      paths = statuses.map(function(status) {  
        return status.path();
      });
      return;
    })
    .then(function() {
      var author = NodeGit.Signature.now("Sketch Server", "noreply@no.reply");
      // return tmpRepo.createCommitOnHead("HEAD", author, author, "initial commit", oid, []);
      return tmpRepo.createCommitOnHead(paths, author, author, "import template");
    })
    .then(function(){
      return tmpRepo.getRemote('origin');
      // return NodeGit.Remote.create(tmpRepo, "origin", repository.path())
    })
    .then(function(remoteResult){
      remote = remoteResult;
      return remote.connect(NodeGit.Enums.DIRECTION.PUSH,{ 
        credentials: function(url, username) {
            return NodeGit.Cred.sshKeyFromAgent(username);
        }
      });
    })
    .then(function(){
      return remote.push(["refs/heads/master:refs/heads/master"])
    })
    .then(function(status){
      return repository.getHeadCommit();
    })
    .then(function(commit){
      child.execFile('node', [SCRIPTS_PATH, sketch.slug, commit.sha()], function(err, out) {
        if (err instanceof Error) {
          throw err;
        }
      })
    })
    .then(function(){
      // need to ensure this happens after screenshot has been called
      // return fse.remove(tmpPath);
    })
    .catch(function(err){
      console.log(err);
    });
  
};

GitController.createSketch = function(sketch){
  console.log('create', sketch)
  if(sketch.template === 'existing'){
    console.log('it already exists')
    return GitController.openRepository(sketch.path);
  }else{
    console.log('it is new')
    return NodeGit.Repository.init(sketch.path, 1).then(function (repo) {
      return GitController.initalCommitHack(sketch, repo);    
    })
    .catch(function(err){
      console.log(err);
      return err;
    });
  }

};

GitController.openRepository = function(path){
 return NodeGit.Repository.openBare(path)
  .then(function (repo) {
    console.log(repo)
    return repo;
  }).catch(function(err){
    return err;
  });
};

GitController.getCommits = function(repository){
  if(typeof(repository) === 'string'){
    return NodeGit.Repository.openBare(repository)
    .then(function (repo) {
      return GitController.allCommits(repo);
      // return GitController.walkCommits(repo);
    }).catch(function(err){
      return err;
    });
  }else{
    return GitController.walkCommits(repository);
  }
};

GitController.getCommitsAndRefs = function(repository){
  return NodeGit.Repository.openBare(repository)
    .then(function (repo) {
      return GitController.allCommits(repo);
    })
    .catch(function(err){
      return err;
    });
  
};

GitController.walkCommits = function(repository){
  
  return repository.getMasterCommit()
    .then(function(firstCommitOnMaster){
      return firstCommitOnMaster.history(NodeGit.Revwalk.SORT.Time);
    })
    .then(function(history){
      return new Promise(function (resolve, reject) {
        history.on("end", function(commits) {
          return resolve(commits);
        });
        history.start();
      });
    })
    .catch(function(err){
      return err;
    })
};

GitController.allCommits = function(repository){
  var walker = repository.createRevWalk(), references;
  walker.sorting(NodeGit.Revwalk.SORT.TIME)
  var commits = [], refs = [];
  walker.pushHead();

  var getCommit = function(ref){
    return repository.getReferenceCommit(ref)
      .then(function(commit){
        console.log('got commit for ', ref);
        return { ref: ref, commit: commit.sha() };
      })
  };

  return repository.getReferenceNames(NodeGit.Reference.TYPE.LISTALL).then(function(references){  
    refs = references;
    references.forEach(function(reference){
      walker.pushRef(reference);
    });
  })
  .then(function(){
    var commits = refs.map(function(ref){
      return getCommit(ref);
    });
    return Promise.all(commits);
  })  
  .then(function(_refs){
    
    // todo, remove hard coded num
    return walker.getCommits(100).then(function(allOfTheCommits) {
      return { commits: allOfTheCommits, references: _refs };
    }).catch(function(err) {console.log(err)});  
  })    
  
};

// this is terrible and needs to be cleaned up
GitController.getFile = function(path, revision, filename){

  return GitController.openRepository(path)
    .then(function(repo){
      
      var match = revision.match(/(test)|(tag=.*)|(branch=.*)|(latest)/i);
      if(match === null){
        return repo.getCommit(revision);
      }else if(match[0].indexOf('tag=') > -1){
        var tag = match[0].split('=')[1];
        return repo.getReferenceCommit(tag).then(function(commit){
          return commit;
        });
      }else if(match[0].indexOf('branch=') > -1){
        var branch = match[0].split('=')[1];
        
        return repo.getBranchCommit(branch).then(function(commit){
          return commit;
        });
      }else if(match[0] === 'latest'){
        console.log('repo: ', repo.getHeadCommit)
        return repo.getHeadCommit();
      }
    })
    .then(function(commit) {
      return commit.getTree();
    })
    .then(function(tree) {
      return tree.getEntry(filename)
    })
    .then(function(entry) {
      return entry.getBlob(filename);
    })
    .then(function(blob) {
      return blob;
    })    
    .catch(function(err){
      console.log(err);
    })
    // .then(function(entry) {
    //   console.log('getting entry', entry);
    //   _entry = entry;
    //   return _entry.getBlob();
    // })
    // .then(function(blob) {
    //   return console.log(_entry.name(), _entry.sha(), blob.rawsize() + "b");
    // })
    // .done();

};

module.exports = GitController;

// function readFileAsync (file, encoding, cb) {
//   if (cb) return fs.readFile(file, encoding, cb)
 
//   return new Promise(function (resolve, reject) {
//     fs.readFile(function (err, data) {
//       if (err) return reject(err)
//       resolve(data)
//     })
//   })
// }