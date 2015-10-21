var AWS = require('aws-sdk'),
    cloudwatchlogs,
    _ = require('lodash'),
    logEvents = [],
    logGroupName = '',
    logStreamName = '',
    messageAsJson = false,
    intervalId;

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
};

module.exports.add = function(log) {
  logEvents.push({
    message: messageAsJson ? JSON.stringify(log, null, '  ') : [log.level, log.msg, JSON.stringify(log.meta, null, '  ')].join(' - '),
    timestamp: new Date().getTime()
  });

  var lastFree = new Date().getTime();
  function upload() {
    if (new Date().getTime() - 2000 > lastFree) {
      getNextToken(function(err, sequenceToken) {
        if (err) {
          return console.log(err, err.stack);
        }

        if (logEvents.length <= 0) {
          return;
        }

        var payload = {
          logGroupName: logGroupName,
          logStreamName: logStreamName,
          logEvents: logEvents.splice(0, 20)
        };
        if (sequenceToken) payload.sequenceToken = sequenceToken;

        cloudwatchlogs.putLogEvents(payload, function(err, data) {
          if (err) return console.log(err, err.stack);
          lastFree = new Date().getTime();
        });
      });
    }
  }
  if (!intervalId) {
    intervalId = setInterval(upload, 1000);
  }
};

function getNextToken(cb) {
  function paginatedSearch(nextToken) {
    var params = {
      logStreamNamePrefix: logStreamName,
      logGroupName: logGroupName
    };
    if (nextToken) {
      params.NextToken = nextToken;
    }
    cloudwatchlogs.describeLogStreams(params, function(err, data) {
      if (err) return cb(err);
      var matches = _.find(data.logStreams, function(logStream) {
        return (logStream.logStreamName === logStreamName);
      });
      if (matches) {
        cb(null, matches.uploadSequenceToken);
      } else if (!data.nextToken) {
        // is this correct? if we dont have a nextToken does that
        // mean that the stream wasnt found?
        cb('Stream', logGroupName, logStreamName, 'not found');
      } else {
        paginatedSearch(data.nextToken);
      }
    });
  }
  paginatedSearch();
}
