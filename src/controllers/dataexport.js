var _ = require('lodash');
var csv = require('express-csv');
var express = require('express');
var nconf = require('nconf');
var moment = require('moment');
var dataexport = module.exports;
var js2xmlparser = require("js2xmlparser");
var pd = require('pretty-data').pd;
var User = require('../models/user').model;

// Avatar screenshot/static-page includes
var Pageres = require('pageres'); //https://github.com/sindresorhus/pageres
var AWS = require('aws-sdk');
AWS.config.update({accessKeyId: nconf.get("S3").accessKeyId, secretAccessKey: nconf.get("S3").secretAccessKey});
var s3Stream = require('s3-upload-stream')(new AWS.S3()); //https://github.com/nathanpeck/s3-upload-stream
var bucket = 'habitrpg-dev';

/*
  ------------------------------------------------------------------------
  Data export
  ------------------------------------------------------------------------
*/

dataexport.history = function(req, res) {
  var user = res.locals.user;
  var output = [
    ["Task Name", "Task ID", "Task Type", "Date", "Value"]
  ];
  _.each(user.tasks, function(task) {
    _.each(task.history, function(history) {
      output.push(
        [task.text, task.id, task.type, moment(history.date).format("MM-DD-YYYY HH:mm:ss"), history.value]
      );
    });
  });
  return res.csv(output);
}

var userdata = function(user) {
  if(user.auth && user.auth.local) {
    delete user.auth.local.salt;
    delete user.auth.local.hashed_password;
  }
  return user;
}

dataexport.leanuser = function(req, res, next) {
  User.findOne({_id: res.locals.user._id}).lean().exec(function(err, user) {
    if (err) return res.json(500, {err: err});
    if (_.isEmpty(user)) return res.json(401, NO_USER_FOUND);
    res.locals.user = user;
    return next();
  });
};

dataexport.userdata = {
  xml: function(req, res) {
      var user = userdata(res.locals.user);
      return res.xml({data: JSON.stringify(user), rootname: 'user'});
    },
  json: function(req, res) {
      var user = userdata(res.locals.user);
      return res.jsonstring(user);
    }
}

/*
  ------------------------------------------------------------------------
  Express Extensions (should be refactored into a module)
  ------------------------------------------------------------------------
*/

var expressres = express.response || http.ServerResponse.prototype;

expressres.xml = function(obj, headers, status) {
  var body = '';
  this.charset = this.charset || 'utf-8';
  this.header('Content-Type', 'text/xml');
  this.header('Content-Disposition', 'attachment');
  body = pd.xml(js2xmlparser(obj.rootname,obj.data));
  return this.send(body, headers, status);
};

expressres.jsonstring = function(obj, headers, status) {
  var body = '';
  this.charset = this.charset || 'utf-8';
  this.header('Content-Type', 'application/json');
  this.header('Content-Disposition', 'attachment');
  body = pd.json(JSON.stringify(obj));
  return this.send(body, headers, status);
};

/*
 ------------------------------------------------------------------------
 Static page and image screenshot of avatar
 ------------------------------------------------------------------------
 */


dataexport.avatarPage = function(req, res) {
  User.findById(req.params.uuid).select('stats profile items achievements preferences backer contributor').exec(function(err, user){
    res.render('avatar-static', {
      title: user.profile.name,
      env: _.defaults({user:user},res.locals.habitrpg)
    });
  })
};

dataexport.avatarImage = function(req, res, next) {
  var filename = 'avatar-'+req.params.uuid+'.png';
  new Pageres()//{delay:1}
    .src(nconf.get('BASE_URL')+'/export/avatar-'+req.params.uuid+'.html', ['140x147'], {crop: true, filename: filename.replace('.png','')})
    .run(function (err, file) {
      if (err) return next(err);
      var upload = s3Stream.upload({
        Bucket: bucket,
        Key: filename,
        ACL: "public-read",
        StorageClass: "REDUCED_REDUNDANCY",
        ContentType: "binary/octet-stream"
      });
      upload.on('error', function (err) {
        next(err);
      });
      upload.on('uploaded', function (details) {
        res.redirect(details.Location);
      });
      file[0].pipe(upload);
    });
};
