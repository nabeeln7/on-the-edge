const MessagingService = require("../../../messaging-service");
const utils = require("../../../utils/utils");

const serviceName = process.env.SERVICE_NAME;
const messagingService = new MessagingService(serviceName);

/**
 * Return the neighboring gateways.
 * @param req
 * @param res
 * @returns {Promise<*>}
 */
exports.getNeighbors = async function (req, res) {
    const response = await messagingService.query(
        serviceName,
        "device-manager",
        "get-neighbors",
        {}
    );
    return res.json(response);
};

/**
 * Returns the active devices.
 * @param req
 * @param res
 * @returns {Promise<*>}
 */
exports.getDevices = async function (req, res) {
    const response = await messagingService.query(
        serviceName,
        "device-manager",
        "get-active-devices",
        {}
    );
    return res.json(response);
};

/**
 * Returns the currently running apps.
 * @param req
 * @param res
 * @returns {Promise<*>}
 */
exports.getApps = async function (req, res) {
    const response = await messagingService.query(
        serviceName,
        "app-manager",
        "get-apps",
        {}
    );
    return res.json(response);
};

/**
 * This call gives the status of the server.
 * It is primarily intended to be used as a means to check reachability.
 * @param req
 * @param res
 * @returns {Promise<*>}
 */
exports.getServerStatus = async function (req, res) {
    // for the time being use a simple json with a status=true key-value
    const status = { status: true };
    return res.json(status);
};

/**
 * This call retrieves the self details of the gateway.
 * @param req
 * @param res
 * @return {*}
 */
exports.getGatewayDetails = function (req, res) {
    const selfDetails = { id: utils.getGatewayId(), ip: utils.getGatewayIp() };
    return res.json(selfDetails);
};

/**
 * This endpoint takes the uploaded code and metadata and
 * executes it using the code-container module.
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
exports.executeApp = async function (req, res) {
    const appPath = req["files"]["app"][0]["path"];
    const metadataPath = req["files"]["metadata"][0]["path"];

    // Forward the application path and metadata.
    // The data format is described in the platform-manager.js
    messagingService.forwardMessage(
        serviceName,
        "app-manager",
        "app-deployment",
        {
            appPath: appPath,
            metadataPath: metadataPath,
        }
    );
    res.send();
};

exports.terminateApp = async function (req, res) {
    const appId = req.params["id"];
    if (appId) {
        // Forward the termination request to app-manager
        const response = await messagingService.query(
            serviceName,
            "app-manager",
            "terminate-app",
            {
                id: appId,
            }
        );
        return res.json(response);
    } else {
        res.status(400).send({
            message: "no app id provided!",
        });
    }
};

exports.getLogStreamingTopic = async function (req, res) {
    const appId = req.params["id"];
    if (appId) {
        // pass the request to app-manager and get back an mqtt topic to listen to the logs
        const response = await messagingService.query(
            serviceName,
            "app-manager",
            "get-log-streaming-topic",
            {
                id: appId,
            }
        );
        return res.json(response);
    } else {
        res.status(400).send({
            message: "no app id provided!",
        });
    }
};

exports.startLogStreaming = async function (req, res) {
    const appId = req.params["id"];
    if (appId) {
        // pass the request to app-manager and get back an mqtt topic to listen to the logs
        const response = await messagingService.query(
            serviceName,
            "app-manager",
            "start-log-streaming",
            {
                id: appId,
            }
        );
        return res.json(response);
    } else {
        res.status(400).send({
            message: "no app id provided!",
        });
    }
};

exports.stopLogStreaming = async function (req, res) {
    const appId = req.params["id"];
    if (appId) {
        // Forward the termination request to app-manager
        const response = await messagingService.query(
            serviceName,
            "app-manager",
            "stop-log-streaming",
            {
                id: appId,
            }
        );
        return res.json(response);
    } else {
        res.status(400).send({
            message: "no app id provided!",
        });
    }
};

// TODO: need to be changed to the general api.
/**
 * This endpoint takes sensor requirement from the remote gateways and
 * passes the sensor requirement to sensor-stream-manager.
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
exports.registerAppSensorRequirement = async function (req, res) {
    // Forward the application's sensor requirement to sensor-stream-manager
    messagingService.forwardMessage(
        serviceName,
        "sensor-stream-manager",
        "register-topic",
        {
            app: req.body,
        }
    );
    res.send();
};

exports.talkToManager = async function (req, res) {
    const jsonData = req.body;

    if (jsonData != null) {
        /*
        Format:
        {
            "_meta" : {
                "recipient": "manager-name-goes-here"
                "event": "..."
            },
            "payload": {
                ...
            }
        }
        */
        const recipient = jsonData["_meta"]["recipient"];
        const event = jsonData["_meta"]["event"];
        const payload = jsonData["payload"];

        messagingService.forwardMessage(serviceName, recipient, event, payload);
    }

    res.send();
};

messagingService.forwardMessage(serviceName, "app-manager", "app-deployment", {
    appPath: `/home/huanglipang/Documents/Work/GitHub/on-the-edge/platform/app-manager/code-container/example-apps/test/test.js`,
    metadataPath: `/home/huanglipang/Documents/Work/GitHub/on-the-edge/platform/app-manager/code-container/example-apps/test/metadata.json`,
});

// setTimeout(() => {
//     for(let i = 0; i < 100; i++) {
//         messagingService.forwardMessage(serviceName, "app-manager", "app-deployment", {
//             "appPath": `/root/on-the-edge/platform/api-server/deployed-apps/test.js`,
//             "metadataPath": `/root/on-the-edge/platform/api-server/deployed-apps/test/metadata.json`
//         });
//     }
// }, 15000)
