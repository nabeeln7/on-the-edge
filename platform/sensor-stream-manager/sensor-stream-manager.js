const fs = require("fs-extra");
const mqtt = require("mqtt");
const utils = require("../utils/utils");
const fetch = require("node-fetch");
const policyHelper = require("./policy");

// TODO: add mqtt-data-collector logic to SSM.
const MessagingService = require("../messaging-service");

/**
 * This function registers topic for local sensors.
 * @param {string} ip - gateway's ip
 * @param {string[]} sensorIds - an array of sensor id
 * @param {string} topic - application's topic
 */
function registerToLocalGateway(ip, sensorIds, topic) {
    for (const id of sensorIds) {
        if (!sensorStreamRouteTable[id]) {
            sensorStreamRouteTable[id] = {};
        }
        if (!sensorStreamRouteTable[id][ip]) {
            sensorStreamRouteTable[id][ip] = [];
        }
        sensorStreamRouteTable[id][ip].push(topic);
    }
}

/**
 * This function sends sensor requirement to the remote gateway.
 * @param {string} ip -remote gateway's ip
 * @param {string[]} sensorIds - an array of sensor id
 * @param {string} topic - application's topic
 */
function registerToRemoteGateway(ip, sensorIds, topic) {
    // Remote gateway's register-topic url
    const gatewayUrl = `http://${ip}:5000/gateway/register-app-sensor-requirement`;
    // Request body
    const body = {
        ip: gatewayIp,
        sensors: sensorIds,
        topic: topic,
    };
    // Send application's sensor requirement to remote gateway
    fetch(gatewayUrl, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        timeout: 5000,
    })
        .then((res) => {
            if (res.status === 200) {
                console.log(`[INFO] Sent "${topic}" to ${ip} successfully!`);
            } else {
                console.error(
                    `[ERROR] Failed to send "${topic}" to ${ip} with status ${res.status}.`
                );
            }
        })
        .catch((err) => {
            console.error(`[ERROR] Failed to send "${topic}" to ${ip}.`);
            console.error(err);
        });
}

/**
 * This function register MQTT clients.
 * @param {string} ip - MQTT broker's ip
 */
function registerMQTTClient(ip) {
    // Check if the MQTT client exists
    if (!mqttClients[ip]) {
        const client = connectToMQTTBroker(ip);
        client.on("connect", () => {
            if (ip === gatewayIp) {
                subscribeToGatewayData(client);
                routeSensorStreamsToApps(client);
            }
            client.on("disconnect", () => {
                console.log(`[INFO] Disconnected to MQTT broker at ${ip}.`);
            });
            console.log(
                `[INFO] Connected to MQTT broker at ${ip} successfully!`
            );
        });
        mqttClients[ip] = client;
    }
}

/**
 * This function connects to MQTT broker
 * @param {string} ip - MQTT broker's ip
 * @returns {Object} - MQTT client
 */
function connectToMQTTBroker(ip) {
    const url = `mqtt://${ip}`;
    // Connect to mqtt broker
    return mqtt.connect(url);
}

/**
 * This function publishes data to application's topic.
 * @param {string} ip - MQTT broker's ip
 * @param {string} topic - application's topic
 * @param {string} data - sensor data
 */
function publishData(ip, topic, data) {
    // Check if the MQTT client exists
    if (!mqttClients[ip]) {
        console.error(`[ERROR] ${ip} has not been registered.`);
        return;
    }
    const client = mqttClients[ip];
    client.publish(topic, data, {}, (err) => {
        if (err) {
            console.error(`[ERROR] Failed to publish to ${ip}.`);
            console.error(err);
        }
    });
}

/**
 * This function lets the local MQTT client
 * subscribes to "gateway-data" topic
 * @param {Object} client - MQTT client
 */
function subscribeToGatewayData(client) {
    const mqttTopic = "gateway-data";
    // Subscribe to "gateway-data"
    client.subscribe(mqttTopic, (err) => {
        if (err) {
            console.error(`[ERROR] Failed to subscribe "${mqttTopic}".`);
            console.error(err);
        } else {
            console.log(
                `[INFO] Subscribed to "${mqttTopic}" topic successfully!`
            );
        }
    });
}

/**
 * This function lets the local MQTT client route
 * the sensor stream to applications
 * @param {Object} client - MQTT client
 */
function routeSensorStreamsToApps(client) {
    client.on("message", (topic, message) => {
        const payload = JSON.parse(message.toString());
        const sensorId = payload["_meta"]["device_id"];
        if (sensorId in sensorStreamRouteTable) {
            for (const gatewayIp in sensorStreamRouteTable[sensorId]) {
                const topics = sensorStreamRouteTable[sensorId][gatewayIp];
                for (const topic of topics) {
                    // Check if the app is blocked
                    if (!policyHelper.isBlocked(sensorId, gatewayIp, topic)) {
                        // Publish to application's topic
                        publishData(gatewayIp, topic, JSON.stringify(payload));
                        console.log(`published to ${gatewayIp}  ${topic}`);
                    }
                }
            }
        }
    });
}

console.log("[INFO] Initialize sensor-stream-manager...");
const serviceName = process.env.SERVICE_NAME;
const messagingService = new MessagingService(serviceName);

const gatewayIp = utils.getGatewayIp();
if (!gatewayIp) {
    console.error(
        "[ERROR] No IP address found. Please ensure the config files are set properly."
    );
    process.exit(1);
}
console.log(`[INFO] Gateway's ip address is ${gatewayIp}`);

// sensorStreamRouteTable stores the sensor id and application topic mapping
// the key is sensor id and the value is an object
// with the key is gateway ip and the value is an array of application's topics
// sensor-stream-manager uses sensorStreamRouteTable to publish sensor stream data
// check the example below
// sensorStreamRouteTable = {
//     "sensor1-id": {
//         "gateway1-ip": [ "app1-topic", "app2-topic" ],
//         "geteway2-ip": [ "app3-topic"]
//     },
//     "sensor2-id": {
//         "gateway1-ip": [ "app1-topic" ],
//         "geteway2-ip": [ "app3-topic"]
//     }
// }
const sensorStreamRouteTable = {};

// mqttClients = {
//     "gateway-ip": client
// }
const mqttClients = {};

registerMQTTClient(gatewayIp);

messagingService.listenForEvent("connect-to-socket", (message) => {
    const payload = message.data;
    const wsAddress = payload["ws-address"];
});

// sensor-stream-manager receives an application's topic and sensor requirements and provides it
messagingService.listenForEvent("request-streams", (message) => {
    // appData = {
    //     "topic": appId,
    //     "metadataPath": appData.metadataPath
    // }
    const appData = message.data;
    if (
        appData.hasOwnProperty("topic") &&
        appData.hasOwnProperty("metadataPath")
    ) {
        // load application's metadata
        let metadata = fs.readJsonSync(appData["metadataPath"]);
        metadata = metadata["deviceMapping"];
        const topic = appData["topic"];
        // store application's sensor stream requirement in sensorStreamRouteTable
        for (const ip in metadata) {
            const sensorIds = metadata[ip];
            // store the sensor connected to local gateway
            if (ip === gatewayIp) {
                registerToLocalGateway(ip, sensorIds, topic);
            } else {
                registerToRemoteGateway(ip, sensorIds, topic);
            }
        }
        console.log(`[INFO] Registered application "${topic}" successfully!`);
    }
});

messagingService.listenForEvent("register-topic", (message) => {
    // appData = {
    //     "app": {
    //         "topic": topic,
    //         "ip": ip,
    //         "sensors": sensorIds
    //     }
    // }
    const appData = message.data;
    if (appData["app"]) {
        const sensorIds = appData["app"]["sensors"];
        const topic = appData["app"]["topic"];
        const ip = appData["app"]["ip"];
        registerMQTTClient(ip);
        registerToLocalGateway(ip, sensorIds, topic);
    }
});

messagingService.listenForEvent("update-policy", (message) => {
    // data = {
    //     "policy": {
    //         "app-specific": {
    //             "app1": {
    //                 "block": true,
    //                 "cron": "* 09-10,13-15 * * *",
    //             }
    //         },
    //         "sensor-specific": {
    //             "sensor1-id": {
    //                 "block": false,
    //                 "cron": "* 09-10,13-15 * * *",
    //             }
    //         },
    //         "app-sensor": {
    //             "sensor1-id": {
    //                 "gateway1-ip": {
    //                     "app1-topic": {
    //                         "block": false,
    //                         "cron": "* 09-10,13-15 * * *",
    //                     }
    //                 }
    //             }
    //         }
    //     }
    // };
    const data = message.data;
    if (data["policy"]) {
        policyHelper.update(data["policy"]);
        console.log(
            `[INFO] Updated policy: ${JSON.stringify(policyHelper.getPolicy())}`
        );
        policyHelper.startRuleTimer();
    }
});

const timeZone = "America/New_York";
policyHelper.setTimeZone(timeZone);
