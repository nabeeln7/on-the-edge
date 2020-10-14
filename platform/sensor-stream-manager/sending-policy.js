const fetch = require("node-fetch");

const policy = {
    "app-specific": {},
    "sensor-specific": {},
    "app-sensor": {
        sensor1: {
            "172.26.149.165": {
                "39ad966dea1b3e2a47ec3e2a654c4b300356b942": {
                    block: true,
                    cron: "*/2 * * * *",
                },
            },
        },
    },
};

// for(let i = 2; i < 100; i++) {
//     let m = i % 3 + 1;
//     policy["sensor-specific"][`sensor${i}`] = {
//         "block": false,
//         "cron": `*/${m} * * * *`,
//     }
// }

// for(let i = 2; i < 100; i++) {
//     let m = i % 3 + 1;
//     policy["app-sensor"][`sensor${i}`] = {
//         "gateway1": {
//             "app1": {
//                 "block": true,
//                 "cron": `*/${m} * * * *`,
//             },
//             "app2": {
//                 "block": true,
//                 "cron": `*/${m} * * * *`,
//             }
//         },
//         "gateway2": {
//             "app3": {
//                 "block": false,
//                 "cron": `*/${m} * * * *`,
//             },
//             "app4": {
//                 "block": false,
//                 "cron": `*/${m} * * * *`,
//             }
//         }
//     }
// }
// console.log(JSON.stringify(policy));
const url = "http://localhost:5000/platform/update-privacy-policy";
fetch(url, {
    body: JSON.stringify(policy), // must match 'Content-Type' header
    cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    credentials: "same-origin", // include, same-origin, *omit
    headers: {
        "content-type": "application/json",
    },
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    referrer: "no-referrer", // *client, no-referrer
});
//   .then(response => {
//       return response.json();
//   }) // 輸出成 json
//   .then(json => console.log(json));
