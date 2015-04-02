var _ = require('lodash');
var Promise = require('bluebird');
var fbuffer = require('flexbuffer');

/**
 * Command instance
 *
 * It's rare that you need to create a Command instance yourself.
 *
 * @constructor
 * @param {string} name - Command name
 * @param {string[]} [args=null] - An array of command arguments
 * @param {string} [replyEncoding=null] - Set the encoding of the reply,
 * by default buffer will be returned.
 * @param {function} [callback=null] - The callback that handles the response.
 * If omit, the response will be handled via Promise.
 * @example
 * var infoCommand = new Command('info', null, function (err, result) {
 *   console.log('result', result);
 * });
 *
 * redis.sendCommand(infoCommand);
 *
 * // When no callback provided, Command instance will have a `promise` property,
 * // which will resolve/reject with the result of the command.
 * var getCommand = new Command('get', ['foo']);
 * getCommand.promise.then(function (result) {
 *   console.log('result', result);
 * });
 *
 * @see {@link Redis#sendCommand} which can send a Command instance to Redis
 * @public
 */
function Command(name, args, replyEncoding, callback) {
  var _this = this;
  this.promise = new Promise(function (resolve, reject) {
    _this.resolve = _this._convertValue(resolve);
    _this.reject = reject;

    _this.name = name.toLowerCase();
    _this.args = args ? _.flatten(args) : [];
    var transformer = Command.transformer.argument[_this.name];
    if (transformer) {
      _this.args = transformer(_this.args);
    }
    _this.replyEncoding = replyEncoding;
  }).nodeify(callback);
}

/**
 * Convert command to writable buffer or string
 *
 * @return {string|Buffer}
 * @see {@link Redis#sendCommand}
 * @public
 */
Command.prototype.toWritable = function () {
  var bufferMode = false;
  var i;
  for (i = 0; i < this.args.length; ++i) {
    if (this.args[i] instanceof Buffer) {
      bufferMode = true;
      break;
    }
  }

  var result;
  if (bufferMode) {
    var resultBuffer = new fbuffer.FlexBuffer();
    resultBuffer.write('*' + (this.args.length + 1) + '\r\n$' + this.name.length + '\r\n' + this.name + '\r\n');
    for (i = 0; i < this.args.length; ++i) {
      var arg = this.args[i];
      if (arg instanceof Buffer || arg instanceof String) {
        if (arg.length === 0) {
          resultBuffer.write('$0\r\n\r\n');
        } else {
          resultBuffer.write('$' + arg.length + '\r\n');
          resultBuffer.write(arg);
          resultBuffer.write('\r\n');
        }
      } else {
        resultBuffer.write('$' + Buffer.byteLength(arg) + '\r\n' + arg + '\r\n');
      }
    }
    result = resultBuffer.getBuffer();
  } else {
    result = Command.multiBulk([this.name].concat(this.args));
  }
  return result;
};

/**
 * Convert the value from buffer to the target encoding.
 *
 * @param {function} resolve - The resolve function of the Promise
 * @return {function} A funtion to transform and resolve a value
 * @private
 */
Command.prototype._convertValue = function (resolve) {
  var _this = this;
  return function (value) {
    // Convert buffer/buffer[] to string/string[]
    if (_this.replyEncoding) {
      if (value instanceof Buffer) {
        value = value.toString(_this.replyEncoding);
      } else if (Array.isArray(value)) {
        for (var i = 0; i < value.length; ++i) {
          if (value[i] instanceof Buffer) {
            value[i] = value[i].toString(_this.replyEncoding);
          }
        }
      }
    }
    var transformer = Command.transformer.reply[_this.name];
    resolve(transformer ? transformer(value) : value);

    return _this.promise;
  };
};

Command.FLAGS = {
  // Commands that can be processed when Redis is loading data from disk
  VALID_WHEN_LOADING: ['info', 'subscribe', 'unsubscribe', 'psubscribe', 'pubsubscribe', 'publish'],
  // Commands that can be processed when client is in the subscriber mode
  VALID_IN_SUBSCRIBER_MODE: ['subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe', 'ping', 'quit'],
  // Commands that will turn current connection into subscriber mode
  ENTER_SUBSCRIBER_MODE: ['subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe'],
  // Commands that will make client disconnect from server TODO shutdown?
  WILL_DISCONNECT: ['quit']
};

Command.transformer = {
  argument: {},
  reply: {}
};

Command.multiBulk = function (values) {
  var str = '*' + values.length + '\r\n';
  for (var i = 0; i < values.length; ++i) {
    str += this.bulk(values[i]);
  }
  return str;
};

Command.bulk = function (value) {
  return '$' + Buffer.byteLength(value) + '\r\n' + value + '\r\n';
};

module.exports = Command;