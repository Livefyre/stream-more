'use strict';

module.exports = More;

var Duplex = require('readable-stream/duplex');
var inherits = require('inherits');

/**
 * A Duplex stream (Readable & Writable) that only passes through
 * the number of items it is instructed to.
 * More also maintains a LIFO stack such that previously emitted Content can
 * be stashed back into More so that it is re-read out later when needed.
 * @constructor
 * @param opts {object}
 * @param [opts.goal=0] {number} The initial amount to let through
 */
function More(opts) {
    opts = opts || {};
    Duplex.call(this, opts);
    this._goal = opts.goal || 0;
    this._stack = [];
    this._requestMore = null;
    this._hasPrefinished = false;
    // will be emitted if someone .ends() the writable
    // side of the More
    this.once('prefinish', function () {
      this._hasPrefinished = true;
    });
};

inherits(More, Duplex);


/**
 * Let more items pass through.
 * This sets the goal of the stream to the provided number.
 * @param newGoal {number} The number of items this stream should
 *     let through before holding again.
 */
More.prototype.setGoal = function (newGoal) {
    this._goal = newGoal;

    if (this._goal > 0) {
        this._fetchAndPush();
    }
};


/**
 * Get the number of objects the stream is waiting for to reach its goal
 */
More.prototype.getGoal = function () {
    return this._goal;
};


/**
 * stack Content that should be re-emitted later in last-in-first-out
 * fashion. stacked stuff is read out before written stuff
 * @param obj {Object} An object to stack, that you may want back later
 */
More.prototype.stack = function (obj) {
    this._stack.push(obj);
    this.emit('hold');
};


/**
 * Required by Duplex subclasses.
 * This ensures that once the goal is reached, no more content
 * passes through.
 * @private
 */
More.prototype._write = function (chunk, encoding, doneWriting) {
    var self = this;

    // Put on BOTTOM of the stack.
    // written stuff comes after all stacked stuff
    this._stack.unshift(chunk);

    // Save the doneWriting cb for later. We'll call it once this
    // new bottom of the stack is popped, and we need more data
    // from the Writable side of the duplex
    this._requestMore = function () {
        self._requestMore = null;
        doneWriting();
    };

    if (this._goal >= 1) {
        this._fetchAndPush();
    } else {
        // Emit 'hold' to signify that there is data waiting, if only
        // the goal were increased. This is useful to render a 'show more'
        // button only if there is data in the buffer, and avoids a
        // show more button that, when clicked, does nothing but disappear
        this.emit('hold');
    }
};


/**
 * Required by Readable subclasses. Get data from upstream. In this case,
 * either the internal ._stack or the Writable side of the Duplex
 * @private
 */
More.prototype._read = function () {
    if (this._goal <= 0 && this._stack.length) {
        // You don't get data yet.
        this.emit('hold');
        return;
    }
    this._fetchAndPush();
};


/**
 * Fetch data from the internal stack (sync) and push it.
 * Or, if there is nothing in the stack, request more from the Writable
 * side of the duplex, which will eventually call this again.
 * @private
 */
More.prototype._fetchAndPush = function () {
    // If there's data in the stack, pop, push it along, & decrement goal
    if (this._stack.length) {
        // There's stuff in the stack. Push it.
        this._goal--;
        this.push(this._stack.pop());
    }

    // If there was no data, or we just pushed the last bit,
    // request more if possible
    if (this._stack.length === 0 &&
        typeof this._requestMore === 'function') {
        this._requestMore();
    }

    // there is no data to push, and no way of requesting more.
    // If this has emitted 'prefinish', then the writable side
    // has been ended, and we should push(null) to signal EOF on readable side
    if (this._hasPrefinished) {
        this.push(null);
    }
};
