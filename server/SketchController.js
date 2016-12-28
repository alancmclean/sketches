var storage = require('node-persist');

var SketchController = function(dataPath){
  storage.initSync({ dir: dataPath });
  var sketches = storage.getItemSync('sketches');

  if(!sketches){
    storage.setItemSync('sketches', []);
  }

  return {

    get: function(slug){
      var sketches = storage.getItemSync('sketches');
      if(!slug){
        return sketches
      }else{
        var sketch = sketches.filter(function(s){ return s.slug === slug; });
        if(sketch.length > 0){
          return sketch[0]
        }else{
          return null
        }
      }
    },

    create: function(sketch){
      var sketches = this.get();
      sketches.push(sketch);
      storage.setItemSync('sketches', sketches);
      return sketches;
    },

    archive: function(slug){
      var sketches = this.get();
      
      if(sketches){
        sketches.forEach(function(sketch, i){
          if(sketch.slug === slug){
            sketches[i].status = 0;
          }
        });

        storage.setItemSync('sketches', sketches);
      }
    },

    update: function(slug, params){
      var sketches = this.get();
      
      if(sketches){
        sketches.forEach(function(sketch, i){
          if(sketch.slug === slug){
            console.log('updating: ', sketch.slug)
            console.log('params: ', params)
            for(var key in params){
              var val = params[key];
              if(key === 'status'){
                val = parseInt(val);
              }
              sketches[i][key] = val;  
            }
          }
        });

        storage.setItemSync('sketches', sketches);
      }
    },

    activate: function(slug){
      var sketches = this.get();
      
      if(sketches){
        sketches.forEach(function(sketch, i){
          if(sketch.slug === slug){
            sketches[i].status = 1;
          }
        });

        storage.setItemSync('sketches', sketches);
      }
    },

    delete: function(slug){
      var sketches = this.get();

      // console.log(sketches.length)      
      sketches = sketches.filter(function(sketch){
        return sketch.slug != slug;
      });

      // console.log(sketches.length)
      storage.setItemSync('sketches', sketches);
      
    }

  };
};

module.exports = SketchController;