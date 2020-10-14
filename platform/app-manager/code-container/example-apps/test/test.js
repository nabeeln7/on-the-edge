const Oracle = require("../../oracle");
const oracle = new Oracle();

// to subscribe for sensor data from a specific device
oracle.receive("sensor0", (message) => {
    console.log(message);
});

oracle.receive("sensor1", (message) => {
    console.log(message);
});

oracle.receive("sensor2", (message) => {
    console.log(message);
});
