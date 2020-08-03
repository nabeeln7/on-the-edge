#!/usr/bin/env node

var events = require('events');
var url    = require('url');
var util   = require('util');

var noble                  = require('noble');
var request                = require('request');
var EddystoneBeaconScanner = require('eddystone-beacon-scanner');
var urlExpander            = require('expand-url');
var _                      = require('lodash');
var debug                  = require('debug')('ble-gateway');
var watchout               = require('watchout');
var async                  = require('async');
var gatewayId              = require('lab11-gateway-id');
var fs                     = require('fs');

// There is a currently unknown issue where this script will hang sometimes,
// for the moment, we work around it with the venerage watchdog timer
var watchdog = new watchout(1*60*1000, function(didCancelWatchdog) {
    if (didCancelWatchdog) {
        // benign
    } else {
        debug("Watchdog tripped");
        process.exit(1);
    }
});


// Whether or not this is running inside of another app as a module.
// We expect this to normally be true.
var am_submodule = (require.main !== module);

// Hardcoded constant for the name of the JavaScript that has the functions
// we care about for this gateway.
var FILENAME_PARSE = 'parse.js'

// Hardcoded constant for the timeout window to check for a new parse.js
var PARSE_JS_CACHE_TIME_IN_MS = 5*60*1000;

// Main object for the BleGateway
var BleGateway = function () {
    debug('Creating a new gateway');
    this._device_to_data = {};

    // Keep a map of URL -> parse.js parsers so we don't have to re-download
    // parse.js for the same devices.
    this._cached_parsers = {};

    // Keep track of shortened URLs to the full expanded URL so we don't
    // have to query each time we get a short URL
    this._cached_urls = {};

    noble.on('discover', this.on_discover.bind(this));
    noble.on('scanStop', this.on_scanStop.bind(this));
    EddystoneBeaconScanner.on('updated', this.on_beacon.bind(this));
    this._device_id_ages = {};
};

// We use the EventEmitter pattern to return parsed objects
util.inherits(BleGateway, events.EventEmitter);

// Call .start() to run the gateway functionality
BleGateway.prototype.start = function () {
    var startScanningOnPowerOn = function() {
        if (noble.state === 'poweredOn') {
            noble.startScanning([], true);
        } else {
            noble.once('stateChange', startScanningOnPowerOn);
        }
    };

    // Get the gateway ID for the running gateway to include in the data packets.
    this._gateway_id = '';
    gatewayId.id((id) => {
        this._gateway_id = id;

        // Now start BLE scanning.
        startScanningOnPowerOn();
    });
};

// We catch this event to detect if scanning ever stops. We don't want it to
// stop, so it's likely that some other process made it stop and we want to
// override that.
BleGateway.prototype.on_scanStop = function () {
    noble.startScanning([], true);
};

// Called on each advertisement packet
BleGateway.prototype.on_discover = function (peripheral) {

    // Get the time
    var received_time = new Date().toISOString();

    // We have seen an eddystone packet from the same address
    if (peripheral.id in this._device_to_data) {

        // Lookup the correct device to get its parser URL identifier
        var device = this._device_to_data[peripheral.id];

        // Check to see if a parser is available
        if (device.request_url in this._cached_parsers) {
            var parser = this._cached_parsers[device.request_url];

            // Unless told not to, we parse advertisements
            if (am_submodule || !argv.noParseAdvertisements) {

                // Check if we have some way to parse the advertisement
                if (parser.parser && parser.parser.parseAdvertisement) {

                    var parse_advertisement_done = function (adv_obj, local_obj) {

                        // only continue if the result was valid
                        if (adv_obj) {
                            adv_obj.id = peripheral.id;

                            // Add a _meta key with some more information
                            adv_obj._meta = {
                                received_time: received_time,
                                device_id:     peripheral.id,
                                receiver:      'ble-gateway',
                                gateway_id:    this._gateway_id
                            };

                            // We broadcast on "advertisement"
                            this.emit('advertisement', adv_obj);

                            // Tickle the watchdog now that we have successfully
                            // handled a pakcet.
                            watchdog.reset();

                            // Now check if the device wants to do something
                            // with the parsed advertisement.
                            if ((am_submodule || !argv.noPublish) && parser.parser.publishAdvertisement) {
                                parser.parser.publishAdvertisement(adv_obj);
                            }
                        }

                        // Local data is optional
                        if (local_obj) {
                            // Add a _meta key with some more information
                            local_obj._meta = {
                                received_time: received_time,
                                device_id:     peripheral.id,
                                receiver:      'ble-gateway',
                                gateway_id:    this._gateway_id,
                                base_url:      device.url
                            };

                            // We broadcast on "local"
                            this.emit('local', local_obj);
                        }
                    };

                    // Call the device specific advertisement parse function.
                    // Give it the done callback.
                    try {
                        // add the device ID for parsers to see
                        peripheral.advertisement.advertiser_id = peripheral.id;
                        parser.parser.parseAdvertisement(peripheral.advertisement, parse_advertisement_done.bind(this));
                    } catch (e) {
                        debug('Error calling parse function for ' + peripheral.id + '\n' + e);
                    }
                }
            }

            // Unless told not to, we see if this device wants us to connect
            if (am_submodule || !argv.noParseServices) {

                var parse_services_done = function (data_obj) {
                    if (data_obj) {
                        data_obj.id = peripheral.id;

                        // After device-specific code is done, disconnect and handle
                        // returned object.
                        peripheral.disconnect((disconnect_error) => {
                            if (!disconnect_error) {
                                // Broadcast this on "data"
                                this.emit('data', data_obj);

                                // Tickle the watchdog now that we have successfully
                                // handled a pakcet.
                                watchdog.reset();

                                // Now check if the device wants to do something
                                // with the parsed service data.
                                if ((am_submodule || !argv.noPublish) && parser.parser.publishServiceData) {
                                    parser.parser.publishServiceData(data_obj);
                                }
                            }
                        });
                    }
                }

                // Check if we have some code to connect
                if (parser.parser && parser.parser.parseServices) {
                    // Use noble to connect to the BLE device
                    peripheral.connect((connect_error) => {
                        if (!connect_error) {
                            // After a successful connection, let the
                            // device specific code read services and whatnot.
                            parser.parser.parseServices(peripheral, parse_services_done.bind(this));
                        }
                    });
                }
            }
        }
    }
};

// Load the downloaded code into a useable module
BleGateway.prototype.require_from_string = function (src, filename) {
    var m = new module.constructor();
    m.paths = module.paths;
    m._compile(src, filename);
    return m.exports;
}

// We want just the base URL.
// So, something like "https://a.com/folder/page.html?q=1#here"
// should turn in to "https://a.com/folder/"
// function get_base_url (full_url) {
BleGateway.prototype.get_base_url = function (full_url) {
    var parsed_url = url.parse(full_url);
    parsed_url.query = '';
    parsed_url.hash = '';
    var clean_url = url.format(parsed_url);
    if (!clean_url.endsWith('/')) {
        // Now check if there is a index.html or similar at the end
        var url_chunks = clean_url.split('/');
        if (url_chunks[url_chunks.length-1].indexOf('.') != -1) {
            url_chunks.pop();
        }
        clean_url = url_chunks.join('/') + '/';
    }
    return clean_url;
}

// Callback when an eddystone beacon is found.
BleGateway.prototype.on_beacon = function (beacon) {
    // Tickle the watchdog
    watchdog.reset();

    // We keep a list of the last time we updated for each device, this allows
    // the gateway to pull down new parse.js files when they update
    if (beacon.id in this._device_id_ages) {
        if ((Date.now() - this._device_id_ages[beacon.id]) < PARSE_JS_CACHE_TIME_IN_MS) {
            return;
        }
    }

    if (beacon.type == 'url') {
        debug('Found eddystone: ' + beacon.id + ' ' + beacon.url);

        // Check if we should rewrite this URL with our own URL shortener.
        // Sorry rawgit.com guy :(
        var need_fixing = ["/6EKY8W","/WRzp2g","/qtn9V9","/WRKqIy","/2W2FTt",
            "/BA1zPM","/8685Uw","/hWTo8W","/nCQV8C","/sbMMHT",
            "/9aD6Wi","/2ImXWJ","/dbhGnF","/3YACnH","/449K5X",
            "/jEKPu9","/xWppj1","/Edukt0"]
        var short_url = beacon.url;
        var url_path = url.parse(beacon.url).pathname;
        if (need_fixing.indexOf(url_path) > -1) {
            short_url = 'https://j2x.us' + url_path;
            debug('Rewrote URL ' + beacon.url + ' to ' + short_url);
        }

        // This is called when we successfully get the expanded URL.
        var got_expanded_url = function (err, full_url) {
            if (!err) {
                // Save this URL expansion. OK to just overwrite it each time.
                this._cached_urls[short_url] = full_url;
                fs.writeFileSync('cached_urls.json', JSON.stringify(this._cached_urls));

                // Create space if this is a new beacon
                if (!(beacon.id in this._device_to_data)) {
                    this._device_to_data[beacon.id] = {};
                }

                // Get only the base (not index.html, for instance)
                var base_url = this.get_base_url(full_url);

                // Store that
                this._device_to_data[beacon.id]['url'] = base_url;

                // Figure out the URL we are going to fetch, and store that
                var request_url = base_url + FILENAME_PARSE;
                this._device_to_data[beacon.id]['request_url'] = request_url;

                // This is called after we successfully try to fetch parse.js
                var got_parse_js = function (err, response) {
                    if (!err && response.statusCode == 200) {
                        debug('Loading ' + FILENAME_PARSE + ' for ' + full_url + ' (' + beacon.id + ')');

                        // Store this in the known parsers object
                        this._cached_parsers[request_url] = {};
                        this._cached_parsers[request_url]['parse.js'] = response.body;
                        fs.writeFileSync('cached_parsers.json', JSON.stringify(this._cached_parsers));

                        // Make the downloaded JS an actual function
                        // TODO (2016/01/11): Somehow check if the parser is valid and discard if not.
                        try {
                            var parser = this.require_from_string(response.body, request_url);
                            this._cached_parsers[request_url].parser = parser;

                            //update the cache to indicate we actually have this parser
                            this._device_id_ages[beacon.id] = Date.now();
                            parser.parseAdvertisement();
                        } catch (e) {
                            debug('Failed to parse advertisement after fetching parser');
                        }

                    } else {
                        debug('Could not fetch parse.js after trying multiple times. (' + beacon.id + ')');
                        try {
                            debug('Trying to find cached parser. (' + beacon.id + ')');
                            cacheString = fs.readFileSync('cached_parsers.json', 'utf-8');
                            this._cached_parsers = JSON.parse(cacheString);
                            for (var r_url in this._cached_parsers) {
                                var parser = this.require_from_string(this._cached_parsers[r_url]['parse.js'], r_url);
                                this._cached_parsers[r_url].parser = parser;
                            }

                            //update the cache to indicate we actually have this parser
                            this._device_id_ages[beacon.id] = Date.now();
                        } catch (e) {
                            debug('Failed to find cached parsers. (' + beacon.id + ')');
                        }
                    }
                };

                // Check if we already know about this URL
                if (!(request_url in this._cached_parsers)) {
                    // Don't have this one yet, so lets get it
                    debug('Fetching ' + request_url + ' (' + beacon.id + ')');

                    // Now see if we can get parse.js
                    async.retry({tries: 1, interval: 2000}, function (cb, r) {
                        request({url: request_url, timeout:1000}, function (err, response, body) {
                            // We want to error if err or 503
                            var request_err = (err || response.statusCode==503);
                            cb(request_err, response);
                        });
                    }, got_parse_js.bind(this));
                } else {
                    debug('Using cached parse.js for ' + beacon.id);
                }

            } else {
                debug('Error getting full URL (' + short_url + ') after several tries.');
                try{
                    debug('Trying to find cached urls. (' + beacon.id + ')');
                    cacheString = fs.readFileSync('cached_urls.json', 'utf-8');
                    this._cached_urls = JSON.parse(cacheString);
                } catch (e) {
                    debug('Failed to find cached urls. (' + beacon.id + ')');
                }
            }
        };

        if (short_url in this._cached_urls) {
            // We already know what this URL expands to. Just use that.
            debug('Using cached url expansion for ' + beacon.id);
            got_expanded_url.call(this, null, this._cached_urls[short_url]);
        } else {
            // Try to expand the URL up to 10 times.
            async.retry(1, function (cb, r) { urlExpander.expand(short_url, cb); }, got_expanded_url.bind(this));
        }

    }
};


// If this is true, we are running this file directly and should
// start the gateway.
if (require.main === module) {
    var argv = require('yargs')
        .help('h')
        .alias('h', 'help')
        .option('no-parse-advertisements', {
            describe: 'this gateway should not parse advertisements',
            boolean: true,
        })
        .option('no-parse-services', {
            describe: 'this gateway should not connect and parse services',
            boolean: true
        })
        .option('no-publish', {
            describe: 'this gateway should not publish parsed data',
            boolean: true
        })
        .argv;

    var bleg = new BleGateway();

    bleg.on('advertisement', function (adv_obj) {
        console.log(adv_obj);
    });

    bleg.on('local', function (local_obj) {
        console.log(local_obj);
    });

    bleg.start();

}else {
    module.exports = new BleGateway();
}