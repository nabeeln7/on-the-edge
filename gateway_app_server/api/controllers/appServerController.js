var gatewayStatusApp = require("../../gatewayStatusApp");
// 'use strict';


// var mongoose = require('mongoose'),
//   Task = mongoose.model('Tasks');

// exports.list_all_tasks = function(req, res) {
//   Task.find({}, function(err, task) {
//     if (err)
//       res.send(err);
//     res.json(task);
//   });
// };




// exports.create_a_task = function(req, res) {
//   var new_task = new Task(req.body);
//   new_task.save(function(err, task) {
//     if (err)
//       res.send(err);
//     res.json(task);
//   });
// };


// exports.read_a_task = function(req, res) {
//   Task.findById(req.params.taskId, function(err, task) {
//     if (err)
//       res.send(err);
//     res.json(task);
//   });
// };


// exports.update_a_task = function(req, res) {
//   Task.findOneAndUpdate({_id: req.params.taskId}, req.body, {new: true}, function(err, task) {
//     if (err)
//       res.send(err);
//     res.json(task);
//   });
// };


// exports.delete_a_task = function(req, res) {


//   Task.remove({
//     _id: req.params.taskId
//   }, function(err, task) {
//     if (err)
//       res.send(err);
//     res.json({ message: 'Task successfully deleted' });
//   });
// };
'use strict';
var mongoose = require('mongoose'),
  util = require('util'),
  AppModel = mongoose.model('Apps');

exports.list_all_apps = function(req, res) {
  AppModel.find({}, function(err, apps) {
    if (err)
      res.send(err);
    res.json(apps);
  });
};

exports.add_app = function(req, res) {
  var new_app = new AppModel(req.body);
  new_app.save(function(err, app) {
    if (err)
      res.send(err);
    res.json(app);
  });
};

// function getRangingKey(res) {
//   var fs = require('fs');
//   fs.readFile('ranging_key.json', 'utf8', function (err, data) {
//     if (err) {
//       console.log("Couldn't read json file");
//       res.sendStatus(501);
//     } else {
//       var ranging_json = JSON.parse(data);  
//       res.json(ranging_json);
//     }    
//   });
// }

// exports.add_gateway = function(req, res) {
//   var user_name = req.body.user;
//   var pass = req.body.pass;
//   var mac_address = req.body.radioMACAddress;

//   if(user_name === "admin" && pass === "pass") {
//     //check if already present
//     AppModel.findOne({ radioMACAddress: mac_address }, 
//       function (err, existing_gateway) {
//         if(!err && existing_gateway) {
//           console.log("Already present. No need to register again.");
//           getRangingKey(res);
//         }
//         else {
//           console.log("Mac address not present. need to register.");
//           var new_gateway = new AppModel({radioMACAddress: mac_address});
//           new_gateway.save(function(err, saved_doc) {
//             if (err) {
//               console.log("Couldn't save in mongo");
//               res.sendStatus(501);
//             } else {
//               getRangingKey(res);
//             }
//           });
//         }
//       }
//     );
//   } else {
//     // res.setHeader('WWW-Authenticate', 'Basic realm="need login"');
//     console.log('Authorization incorrect, send 401.');
//     res.sendStatus(401);
//   }
// };

exports.exec = function(req, res) {
  AppModel.findById(req.params.appId, function(err, app) {
      if (!err) {
        switch(app.app_name) {
          case "gateway status":
            res.json(gatewayStatusApp.getGatewayStatus());
        }
      } else {
        res.sendStatus(404);
      }
    });
};


exports.read = function(req, res) {
  AppModel.findById(req.params.appId, function(err, app) {
    if (err)
      res.send(err);
    res.json(app);
  });
};


exports.update = function(req, res) {
  AppModel.findOneAndUpdate({_id: req.params.appId}, req.body, {new: true}, function(err, app) {
    if (err)
      res.send(err);
    res.json(app);
  });
};


exports.delete = function(req, res) {
  AppModel.remove({
    _id: req.params.appId
  }, function(err, app) {
    if (err)
      res.send(err);
    res.json({ message: 'App successfully deleted' });
  });
};