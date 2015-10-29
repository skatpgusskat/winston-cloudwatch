var AWS = require('aws-sdk'),
    cloudwatchlogs,
    _ = require('lodash'),
    logEvents = [],
    logGroupName = '',
    logStreamName = '',
    messageAsJson = false,
    sequenceToken;

module.exports.init = function(awsLogGroupName, awsLogStreamName, awsAccessKeyId, awsSecretKey, awsRegion, jsonMessage) {
  if (awsAccessKeyId && awsSecretKey && awsRegion) {
    cloudwatchlogs = new AWS.CloudWatchLogs({accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretKey, region: awsRegion});
  } else if (awsRegion && !awsAccessKeyId && !awsSecretKey) {
    // Amazon SDK will automatically pull access credentials from IAM Role when running on EC2 but region still needs to be configured
    cloudwatchlogs = new AWS.CloudWatchLogs({region: awsRegion});
  } else {
    cloudwatchlogs = new AWS.CloudWatchLogs();
  }
  logGroupName = awsLogGroupName;
  logStreamName = awsLogStreamName;
  messageAsJson = jsonMessage;

  createStream(awsLogGroupName, awsLogStreamName, function(err) {
    if (err && err.code != 'ResourceAlreadyExistsException') console.log(err, err.stack);
  });

  function loop() {
    upload(function() {
      setTimeout(loop, 500);
    });
  }
  loop();
};

module.exports.add = function(log) {
  var message = [log.level, log.msg, JSON.stringify(log.meta, null, '  ')].join(' - ');
  if (messageAsJson) message = JSON.stringify(log, null, '  ');
  logEvents.push({ message: message, timestamp: new Date().getTime() });
};

function upload(done) {
  if (logEvents.length <= 0) return done();

  var payload = {
    logGroupName: logGroupName,
    logStreamName: logStreamName,
    logEvents: logEvents.splice(0, 20)
  };
  if (sequenceToken) {
    payload.sequenceToken = sequenceToken;
    cloudwatchlogs.putLogEvents(payload, function(err, data) {
      if (err) console.log(err, err.stack);
      sequenceToken = data.sequenceToken;
      done();
    });
  } else {
    getSequenceTokenFirstRun(function(err, sequenceToken) {
      payload.sequenceToken = sequenceToken;
      cloudwatchlogs.putLogEvents(payload, function(err, data) {
        if (err) console.log(err, err.stack);
        sequenceToken = data.sequenceToken;
        done();
      });
    });
  }
}

function createStream(groupName, streamName, cb) {
  var payload = { logGroupName: groupName, logStreamName: streamName };
  cloudwatchlogs.createLogStream(payload, cb);
}

function getSequenceTokenFirstRun(cb) {
  findLogStream(logGroupName, logStreamName, function(err, logStream) {
    if (err) {
      return cb(err);
    }
    cb(null, logStream.uploadSequenceToken);
  });
}

function findLogStream(logGroupName, logStreamName, cb) {
  function next(token) {
    var params = {
      logStreamNamePrefix: logStreamName,
      logGroupName: logGroupName
    };
    cloudwatchlogs.describeLogStreams(params, function(err, data) {
      if (err) return cb(err);
      var matches = _.find(data.logStreams, function(logStream) {
        return (logStream.logStreamName === logStreamName);
      });
      if (matches) {
        cb(null, matches);
      } else if (!data.nextToken) {
        cb(new Error('Stream not found'));
      } else {
        next(data.nextToken);
      }
    });
  }
  next();
}
