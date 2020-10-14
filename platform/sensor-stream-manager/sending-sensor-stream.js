const mqtt = require("mqtt");
const cronJob = require("cron").CronJob;

const sensorNumber = 3;

let url = `mqtt://172.26.149.165`;
let clients = mqtt.connect(url);
clients.on("connect", () => {
    clients.on("disconnect", () => {
        console.log(`[INFO] Disconnected to MQTT broker at localhost.`);
    });
    console.log(`[INFO] Connected to MQTT broker at localhost successfully!`);
});

const topic = "gateway-data";
const timeZone = "Asia/Taipei";
let dataset = [];
for (let i = 0; i < sensorNumber; i++) {
    dataset.push(
        JSON.stringify({
            device: "PowerBlade",
            _meta: { device_id: `sensor${i}` },
        })
    );
}
let jobs = [];
for (let i = 0; i < sensorNumber; i++) {
    let job = new cronJob({
        cronTime: "* * * * * *",
        onTick: () => {
            clients.publish(topic, dataset[i], {}, (err) => {
                if (err) {
                    console.error(`[ERROR] Failed to publish to localhost.`);
                    console.error(err);
                }
                console.log(`send sensor${i}`);
            });
        },
        timeZone: timeZone,
    });
    jobs.push(job);
}
for (let i = 0; i < sensorNumber; i++) {
    jobs[i].start();
}
