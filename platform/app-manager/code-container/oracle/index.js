const EventEmitter = require("events");
const MqttController = require("./mqtt-controller");
const mqttController = MqttController.getInstance();
const httpUtils = require("./http-utils");

let gatewayDetails = undefined;
const callbackMap = {};

class Oracle extends EventEmitter {
    constructor() {
        super();
        const platformApiTopic = "platform-data"; // this topic is used for disseminate and query apis
        const applicationTopic = process.env.TOPIC; // receive the application's topic as an environment variable

        if (!applicationTopic) {
            console.error(
                "Application did not receive a topic from App Manager. Exiting."
            );
            process.exit(1);
        }

        // if a new data is published in the topic, oracle will check if the application is listening for that deviceId
        // if so, it sends the message to the callback function
        mqttController.subscribe("localhost", applicationTopic, (message) => {
            const messageJson = JSON.parse(message);
            const deviceId = messageJson["_meta"]["device_id"];
            if (deviceId in callbackMap) {
                callbackMap[deviceId](messageJson);
            }
        });

        mqttController.subscribe("localhost", platformApiTopic, (message) => {
            const messageJson = JSON.parse(message);
            const api = messageJson._meta.api;
            const tag = messageJson._meta.tag;
            this.emit(api, tag, messageJson);
        });
    }

    receive(deviceId, callback) {
        callbackMap[deviceId] = callback;
        console.log(`[oracle] added callback for ${deviceId}`);
    }

    send(deviceId, data) {
        const execUrl = `http://localhost:5000/gateway/talk-to-manager`;
        const talkToManagerData = {
            _meta: {
                recipient: "app-manager",
                event: "send-to-device",
            },
            payload: {
                "device-id": deviceId,
                "send-api-data": data,
            },
        };
        httpUtils.sendPostRequest(execUrl, talkToManagerData);
    }

    disseminateAll(tag, data) {
        this._getIPAddress()
            .then((ipAddress) => {
                const metadata = {
                    "origin-address": ipAddress,
                    api: "disseminate-all",
                    tag: tag,
                };
                const fullData = { _meta: metadata, data: data };
                httpUtils.sendPostRequest(
                    `http://localhost:5000/platform/disseminate-all`,
                    fullData
                );
            })
            .catch((err) => {
                console.err(err);
            });
    }

    queryAll(tag, replyTag, data) {
        this._getIPAddress()
            .then((ipAddress) => {
                const metadata = {
                    "origin-address": ipAddress,
                    api: "query-all",
                    tag: tag,
                    "reply-tag": replyTag,
                };
                const fullData = { _meta: metadata, data: data };
                httpUtils.sendPostRequest(
                    `http://localhost:5000/platform/query-all`,
                    fullData
                );
            })
            .catch((err) => {
                console.err(err);
            });
    }

    _getIPAddress() {
        return new Promise((resolve, reject) => {
            if (!gatewayDetails) {
                httpUtils
                    .sendGetRequest("http://localhost:5000/gateway/details")
                    .then((res) => res.json())
                    .then((selfDetailsJson) => {
                        gatewayDetails = selfDetailsJson;
                        resolve(selfDetailsJson.ip);
                    })
                    .catch((err) => {
                        reject(err);
                    });
            } else {
                resolve(gatewayDetails.ip);
            }
        });
    }
}

module.exports = Oracle;
