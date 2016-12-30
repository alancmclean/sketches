#!/usr/bin/env node

var slug = process.argv[2];
var rev = process.argv[3];
var path = require('path');
var fse  = require('fs-extra');
var storage = require('node-persist');
var lwip = require('lwip');
var contents = fse.readFileSync(path.resolve(__dirname, "../tmp/SETTINGS.json"));
var settings = JSON.parse(contents);
var webshot = require('webshot');

storage.initSync({ dir: settings.data });
var sketches  = storage.getItemSync('sketches');
var sketch   = sketches.filter(function(s){ 
  return s.slug === slug; 
});

if(sketch.length > 0){
  sketch = sketches[0];
  if(sketch.screenshots === true){
    var tmpPath = path.resolve(settings.screenshots, slug, rev+'.png');
    var finalPath = path.resolve(settings.screenshots, slug, rev+'-thumb.jpg');

    var dir = path.resolve(settings.screenshots, slug);
    if (!fse.existsSync(dir)){
      fse.mkdirSync(dir);
    }


    webshot(`http://localhost:${settings.port}/view/${slug}/${rev}/`, tmpPath, { defaultWhiteBackground: true}, function(error) {
      if(error) {
        console.log('nope')
        console.log(error)
      }

      lwip.open(tmpPath, function(err, image){
        console.log('trying to open', image)
        if(err){
          console.log(';first errror')
          throw(err);
          process.exit(0);
        }
        // check err...
        // define a batch of manipulations and save to disk as JPEG:
        image.scale(.35, function(err, img){
          img.writeFile(finalPath, function(err){
            if(err){
             throw(err);
             process.exit(0);
            }
            fse.copySync(finalPath, path.resolve(settings.screenshots, slug, 'latest.jpg'));
            fse.removeSync(tmpPath);
            // check err...
            // done.
            process.exit(0);              
          });
        })          
      });
    });
  }
}else{
  console.log('cant find that sketch');
}

