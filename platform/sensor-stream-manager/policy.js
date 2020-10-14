const cronParser = require("@huanglipang/cron-parser");

let timeZone = "America/New_York";

// nextRuleTime is a cronDate object which stores the time to update the rule.
let nextRuleTime = undefined;
// setTimeout object
let timer = undefined;

// |---------------------------------------------|
// |               Privacy Policy                |
// |--------|------|---------------|-------------|
// | sensor | app  | interval      | block/allow |
// |--------|------|---------------|-------------|
// | s1     | app1 | * 06-07 * * * | true        |
// | *      | app2 | * 08-17 * * * | true        |
// | s2,s3  | *    | * 0-12 * * *  | false       |
// |--------|------|---------------|-------------|

// cron format
// *    *    *    *    *    *
// ┬    ┬    ┬    ┬    ┬    ┬
// │    │    │    │    │    |
// │    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
// │    │    │    │    └───── month (1 - 12)
// │    │    │    └────────── day of month (1 - 31)
// │    │    └─────────────── hour (0 - 23)
// │    └──────────────────── minute (0 - 59)
// └───────────────────────── second (0 - 59, optional)

// privacyPolicy = {
//     "app-specific": {
//         "app1": {
//             "block": true,
//             "cron": "* 09-10,13-15 * * *",
//         }
//     },
//     "sensor-specific": {
//         "sensor1-id": {
//             "block": false,
//             "cron": "* 09-10,13-15 * * *",
//         }
//     },
//     "app-sensor": {
//         "sensor1-id": {
//             "gateway1-ip": {
//                 "app1-topic": {
//                     "block": false,
//                     "cron": "* 09-10,13-15 * * *",
//                 }
//             }
//         }
//     }
// }
const privacyPolicy = {
    "app-specific": {},
    "sensor-specific": {},
    "app-sensor": {},
};

// intervalRule stores the blocked sensor-app mapping within this minute.
// intervalRule = {
//     "sensor-specific": ["sensor1"],
//     "app-specific":{
//         "gateway2":["app2"]
//     },
//     "app-sensor": {
//         "sensor2": {
//             "gateway2":["app2"]
//         }
//     }
// }
let intervalRule = {
    "app-specific": {},
    "sensor-specific": [],
    "app-sensor": {},
};

/**
 * This function compiles the cron like policy and return a CronDate object pointer.
 * @param {Object} policy - cron like policy
 * @param {Object} currentDate - Date object
 * @returns {Object} CronDate object pointer
 */
function compilePolicyToIntervals(policy, currentDate) {
    const options = {
        currentDate: currentDate,
        tz: timeZone,
    };
    return cronParser.parseExpression(policy["cron"], options);
}

/**
 * This function calculates the time difference between date1 and date2 and returns the time in milliseconds.
 * @param {Object} date1 - Date or CronDate
 * @param {Object} date2 - Date or CronDate
 * @returns {number} time in millisecond
 */
function getTimeDifference(date1, date2) {
    return date1.getTime() - date2.getTime();
}

/**
 * This function returns the material which will be used for updating `intervalRule` and `nextRuleTime`.
 * `updateTime` indicates the next update time of the policy.
 * @param {Object} sensorPolicy
 * @param {Object} now - Date
 * @returns {Array} - `intervals` is a CronDate object pointer. `updateTime` is a CronDate object.
 */
function getUpdateRuleMaterial(sensorPolicy, now) {
    const intervals = compilePolicyToIntervals(sensorPolicy, new Date(now));
    const updateTime = intervals.next();
    return [intervals, updateTime];
}

/**
 * This function update `intervalRule`. It first pushes the topic to `intervalRuleType`.
 * It first checks if the sensorId or gatewayIp in the intervalRuleType. Next, push topic or sensorId
 * to the block lists.
 * @param {string} blockTarget - app topic or sensor id
 * @param {Object} intervalRuleType - intervalRule[type]
 * @param {string} key1 - nested policy keys (sensorId, gatewayIp)
 * @param {...string} restkeys - sensorId, gatewayIp
 */
function updateIntervalRule(blockTarget, intervalRuleType, key1, ...restKeys) {
    if (!key1) {
        // sensor-specific goes here
        // push blockTarget to inerval policy
        intervalRuleType.push(blockTarget);
    } else if (restKeys.length === 0) {
        if (!intervalRuleType.hasOwnProperty(key1)) {
            intervalRuleType[key1] = [];
        }
        if (!intervalRuleType[key1].includes(blockTarget)) {
            // push blockTarget to inerval policy
            intervalRuleType[key1].push(blockTarget);
        }
    } else {
        if (!intervalRuleType.hasOwnProperty(key1)) {
            intervalRuleType[key1] = {};
        }
        updateIntervalRule(blockTarget, intervalRuleType[key1], ...restKeys);
    }
}

/**
 * This function checks if the policy should be update to `intervalRule` or not.
 * @param {bool} isInInterval - if current time in the interval
 * @param {bool} block - block or allow
 * @param {string} blockTarget - app topic or sensor id
 * @param {Object} intervalRuleType - intervalRule[type]
 * @param {string} key1 - nested policy keys (sensorId, gatewayIp)
 * @param {...string} restkeys - sensorId, gatewayIp
 */
function updateRuleProcedure(
    isInInterval,
    block,
    blockTarget,
    intervalRuleType,
    key1,
    ...restKeys
) {
    if (isInInterval) {
        if (block) {
            updateIntervalRule(
                blockTarget,
                intervalRuleType,
                key1,
                ...restKeys
            );
        }
    } else {
        if (!block) {
            updateIntervalRule(
                blockTarget,
                intervalRuleType,
                key1,
                ...restKeys
            );
        }
    }
}

/**
 * This function updates `nextRuleTime`. If `nextRuleTime` is further than `tempNextRuleTime`, `nextRuleTime`
 * will be updated.
 * @param {Object} tempNextRuleTime - CronDate object
 */
function updateRuleTime(tempNextRuleTime) {
    // if orgNextUpdateTime is undefined or
    // compare the nearest time with orgNextUpdateTime
    if (!nextRuleTime || tempNextRuleTime.getTime() < nextRuleTime.getTime()) {
        nextRuleTime = tempNextRuleTime;
    }
}

/**
 * This function walk through sensor-specific policy and update to `intervalRule`.
 * @param {Object} now - Date object
 */
function updateRuleBySensorSpecificPolicy(now) {
    const type = `sensor-specific`;
    const sensorIds = privacyPolicy[type];
    for (const sensorId in sensorIds) {
        const sensorPolicy = sensorIds[sensorId];
        const [intervals, updateTime] = getUpdateRuleMaterial(
            sensorPolicy,
            now
        );
        updateRuleProcedure(
            intervals.isInInterval(now),
            sensorPolicy["block"],
            sensorId,
            intervalRule[type]
        );
        updateRuleTime(updateTime);
    }
}

/**
 * This function walk through app-specific policy and update to `intervalRule`.
 * @param {Object} now - Date object
 */
function updateRuleByAppSpecificPolicy(now) {
    const type = `app-specific`;
    const gatewayIps = privacyPolicy[type];
    for (const gatewayIp in gatewayIps) {
        const topics = gatewayIps[gatewayIp];
        for (const topic in topics) {
            const sensorPolicy = topics[topic];
            const [intervals, updateTime] = getUpdateRuleMaterial(
                sensorPolicy,
                now
            );
            updateRuleProcedure(
                intervals.isInInterval(now),
                sensorPolicy["block"],
                topic,
                intervalRule[type],
                gatewayIp
            );
            updateRuleTime(updateTime);
        }
    }
}

/**
 * This function walk through app-sensor policy and update to `intervalRule`.
 * @param {Object} now - Date object
 */
function updateRuleByAppSensorPolicy(now) {
    const type = `app-sensor`;
    const sensorIds = privacyPolicy[type];
    for (const sensorId in sensorIds) {
        if (intervalRule["sensor-specific"].includes(sensorId)) {
            continue;
        }
        const gatewayIps = sensorIds[sensorId];
        for (const gatewayIp in gatewayIps) {
            const topics = gatewayIps[gatewayIp];
            for (const topic in topics) {
                if (
                    intervalRule["app-specific"][gatewayIp] &&
                    intervalRule["app-specific"][gatewayIp].includes(topic)
                ) {
                    continue;
                }
                const sensorPolicy = topics[topic];
                const [intervals, updateTime] = getUpdateRuleMaterial(
                    sensorPolicy,
                    now
                );
                updateRuleProcedure(
                    intervals.isInInterval(now),
                    sensorPolicy["block"],
                    topic,
                    intervalRule[type],
                    sensorId,
                    gatewayIp
                );
                updateRuleTime(updateTime);
            }
        }
    }
}

/**
 * This function walks through the privacy policy and updates `intervalRule` and `nextRuleTime`.
 */
function updateRuleJob() {
    const now = new Date();
    intervalRule = {
        "sensor-specific": [],
        "app-specific": {},
        "app-sensor": {},
    };
    nextRuleTime = undefined;
    updateRuleBySensorSpecificPolicy(now);
    updateRuleByAppSpecificPolicy(now);
    updateRuleByAppSensorPolicy(now);
    console.log(
        `[INFO] Updated interval policy: ${JSON.stringify(intervalRule)}`
    );
}

/**
 * This function updates `timer`. `timer` is an object returned by `setTimeout` function.
 * `timer` will count the time set by `nextRuleTime`.
 */
function updateTimer() {
    // check if next interval exists
    if (nextRuleTime) {
        if (timer) {
            // clear setTimeout when update policy
            clearTimeout(timer);
        }
        const now = new Date();
        // calculate the interval for next execution
        const interval = getTimeDifference(nextRuleTime, now);
        console.log(
            `[INFO] Next update time: ${nextRuleTime}, interval: ${interval}`
        );
        timer = setTimeout(() => {
            ruleTimerJob();
        }, interval);
    }
}

/**
 * This function update `intervalRule` and start `timer`.
 */
function ruleTimerJob() {
    updateRuleJob();
    updateTimer();
}

/**
 * This function sets time zone.
 * @param {string} tz - time zone
 */
function setTimeZone(tz) {
    timeZone = tz;
}

/**
 * This function updates the privacyPolicy.
 * @param {Object} policy
 */
function updatePolicy(policy) {
    for (const type in policy) {
        if (type === "app-sensor") {
            const sensorIds = policy[type];
            for (const sensorId in sensorIds) {
                const gatewayIps = sensorIds[sensorId];
                for (const gatewayIp in gatewayIps) {
                    const topics = gatewayIps[gatewayIp];
                    for (const topic in topics) {
                        if (!privacyPolicy[type].hasOwnProperty(sensorId)) {
                            privacyPolicy[type][sensorId] = {};
                        }
                        if (
                            !privacyPolicy[type][sensorId].hasOwnProperty(
                                gatewayIp
                            )
                        ) {
                            privacyPolicy[type][sensorId][gatewayIp] = {};
                        }
                        privacyPolicy[type][sensorId][gatewayIp][topic] =
                            topics[topic];
                    }
                }
            }
        } else if (type === "sensor-specific") {
            const sensorIds = policy[type];
            for (const sensorId in sensorIds) {
                privacyPolicy[type][sensorId] = sensorIds[sensorId];
            }
        } else if (type === "app-specific") {
            const gatewayIps = policy[type];
            for (const gatewayIp in gatewayIps) {
                const topics = gatewayIps[gatewayIp];
                for (const topic in topics) {
                    if (!privacyPolicy[type].hasOwnProperty(gatewayIp)) {
                        privacyPolicy[type][gatewayIp] = {};
                    }
                    privacyPolicy[type][gatewayIp][topic] = topics[topic];
                }
            }
        }
    }
    clearEmptyPolicy();
}

/**
 * This function will clear empty policy. SSM will receive empty policy if the user
 * want to delete the existed policy.
 */
function clearEmptyPolicy() {
    for (const type in privacyPolicy) {
        if (type === "app-sensor") {
            for (const sensor in privacyPolicy["app-sensor"]) {
                for (const gateway in privacyPolicy["app-sensor"][sensor]) {
                    for (const topic in privacyPolicy["app-sensor"][sensor][
                        gateway
                    ]) {
                        if (
                            !Object.keys(
                                privacyPolicy["app-sensor"][sensor][gateway][
                                    topic
                                ]
                            ).length
                        ) {
                            delete privacyPolicy["app-sensor"][sensor][gateway][
                                topic
                            ];
                        }
                    }
                    if (
                        !Object.keys(
                            privacyPolicy["app-sensor"][sensor][gateway]
                        ).length
                    ) {
                        delete privacyPolicy["app-sensor"][sensor][gateway];
                    }
                }
                if (!Object.keys(privacyPolicy["app-sensor"][sensor]).length) {
                    delete privacyPolicy["app-sensor"][sensor];
                }
            }
        } else if (type === "sensor-specific") {
            for (const sensor in privacyPolicy["sensor-specific"]) {
                if (
                    !Object.keys(privacyPolicy["sensor-specific"][sensor])
                        .length
                ) {
                    delete privacyPolicy["sensor-specific"][sensor];
                }
            }
        } else if (type === "app-specific") {
            for (const sensor in privacyPolicy["app-specific"]) {
                for (const gateway in privacyPolicy["app-specific"][sensor]) {
                    if (
                        !Object.keys(
                            privacyPolicy["app-specific"][sensor][gateway]
                        ).length
                    ) {
                        delete privacyPolicy["app-specific"][sensor][gateway];
                    }
                }
                if (
                    !Object.keys(privacyPolicy["app-specific"][sensor]).length
                ) {
                    delete privacyPolicy["app-specific"][sensor];
                }
            }
        }
    }
}

/**
 * This function is used for checking if the sensorId or topic in the block list in `intervalRule`.
 * @param {string} sensorId
 * @param {string} ip - MQTT broker's ip
 * @param {string} topic - application's topic
 * @returns {bool} - if the sensor is blocked
 */
function isBlocked(sensorId, ip, topic) {
    if (intervalRule["sensor-specific"].includes(sensorId)) {
        return true;
    }
    if (
        intervalRule["app-specific"][ip] &&
        intervalRule["app-specific"][ip].includes(topic)
    ) {
        return true;
    }
    if (
        intervalRule["app-sensor"][sensorId] &&
        intervalRule["app-sensor"][sensorId][ip] &&
        intervalRule["app-sensor"][sensorId][ip].includes(topic)
    ) {
        return true;
    }
    return false;
}

/**
 * This function returns `privacyPolicy`.
 * @returns {Object}
 */
function getPrivacyPolicy() {
    return privacyPolicy;
}

/**
 * This function returns `intervalRule`.
 * @returns {Object}
 */
function getIntervalRule() {
    return intervalRule;
}

module.exports = {
    getPolicy: getPrivacyPolicy,
    getRule: getIntervalRule,
    isBlocked: isBlocked,
    update: updatePolicy,
    setTimeZone: setTimeZone,
    startRuleTimer: ruleTimerJob,
};
