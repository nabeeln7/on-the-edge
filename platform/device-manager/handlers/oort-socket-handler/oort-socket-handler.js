/*
Connects and controls the OORT/WiTenergy Smart Socket
 */
const BleController = require('ble-controller');
const bleController = BleController.getInstance();

const OORT_SERVICE_INFO_UUID = '180a';
const OORT_SERVICE_SENSOR_UUID = '0000fee0494c4f474943544543480000';

const OORT_CHAR_SYSTEMID_UUID = '2a23';

const OORT_CHAR_CLOCK_UUID = '0000fee3494c4f474943544543480000';
const OORT_CHAR_SENSOR_UUID = '0000fee1494c4f474943544543480000';
const OORT_CHAR_CONTROL_UUID = '0000fee2494c4f474943544543480000';

let oortSensorCharacteristic = null;
let oortClockCharacteristic = null;

// Stores any pending messages that need to be sent to a peripheral via BLE.
// Type: deviceId -> [data]
const pendingMessages = {};

class OortSocketHandler {
    constructor(handlerId) {
        this.handlerId = handlerId;
        this.deviceType = "oort-smart-socket";
        this.isHandlingMessages = false;
        this.registeredDevices = [];
    }

    start(platformCallback) {
        this.platformCallback = platformCallback;
        bleController.initialize().then(() => {
            bleController.getPeripheralsWithUuid(OORT_SERVICE_SENSOR_UUID,
                this._handlePeripheral.bind(this));
        });
    }

    dispatch(deviceId, data) {
        // currently, the only type of data we support is state = T/F
        /*
        {
            "state": "on"
        }
         */
        // add to pendingMessages
        if(pendingMessages.hasOwnProperty(deviceId)) {
            pendingMessages[deviceId].push(data);
        } else {
            pendingMessages[deviceId] = [data];
        }
    }

    async _handlePeripheral(peripheral) {
        const deviceId = peripheral.id;

        // if device is unregistered, then register it with the platform
        if(!this.registeredDevices.includes(deviceId)) {
            this.platformCallback.register(deviceId, this.deviceType, this.handlerId);
            this.registeredDevices.push(deviceId);
        }

        // if there are any pending messages for this deviceId, connect to it and send them
        /*
         There were instances where two async callbacks would both try to handle the pendingMessages leading to issues.
         isHandlingMessages is a naive way to implement a critical section to ensure that two handlers don't handle
         pendingMessages at the same time.
         */
        if(pendingMessages.hasOwnProperty(deviceId) && !this.isHandlingMessages) {
            this.isHandlingMessages = true;

            console.log(`[OORT] There are pending messages to be sent for ${peripheral.id}`);

            //get the list of messages
            const messageList = pendingMessages[peripheral.id];
            const message = messageList.shift();

            const state = message["state"] === "on";
            await this._setOortState(peripheral, state);

            if(messageList.length === 0) {
                delete pendingMessages[peripheral.id];
                console.log("[oort-socket-handler] Deleted messages for peripheral");
            }
            this.isHandlingMessages = false;
        }
    }

    // Reference: https://github.com/lab11/accessor-files/blob/master/accessors/sensor/power/oortSmartSocket.js
    async _initializeOortSocket(peripheral) {
        await bleController.connectToPeripheralAsync(peripheral);
        console.log("[OORT] connected to peripheral");
        const services = await bleController.discoverServices(peripheral, [OORT_SERVICE_INFO_UUID, OORT_SERVICE_SENSOR_UUID]);

        // parse through the services and figure out the "info" and "sensor" service indices
        let infoIndex = -1;
        let sensorIndex = -1;
        for (let i = 0; i < services.length; i++) {
            if(services[i].uuid === OORT_SERVICE_INFO_UUID) {
                infoIndex = i;
            } else if(services[i].uuid === OORT_SERVICE_SENSOR_UUID) {
                sensorIndex = i;
            }
        }

        if(infoIndex === -1) {
            console.error('[OORT] Could not find a device info service. Can\'t set date.');
            throw 'Could not find a device info service. Can\'t set date.';
        }

        if(sensorIndex === -1) {
            console.error('[OORT] Could not find sensor service for OORT.');
            throw 'Could not find sensor service for OORT.';
        }

        //get the info characteristics
        const infoChars = await bleController.discoverCharacteristics(services[infoIndex], [OORT_CHAR_SYSTEMID_UUID]);

        if(infoChars.length === 0) {
            console.error('[OORT] Could not get the System ID characteristic.');
            throw 'Could not get the System ID characteristic.';
        }

        const systemId = await bleController.readCharacteristic(infoChars[0]);

        // Get the characteristics of the sensor service
        const sensorChars = await bleController.discoverCharacteristics(services[sensorIndex],
            [OORT_CHAR_CLOCK_UUID, OORT_CHAR_SENSOR_UUID]);

        for (let i = 0; i < sensorChars.length; i++) {
            if(sensorChars[i].uuid === OORT_CHAR_CLOCK_UUID) {
                oortClockCharacteristic = sensorChars[i];
            } else if(sensorChars[i].uuid === OORT_CHAR_SENSOR_UUID) {
                oortSensorCharacteristic = sensorChars[i];
            }
        }

        // Upon connection, the clock has to be set in order for the OORT to not call disconnect on the connection
        const now = new Date();
        const dataToSend = [0x03];

        dataToSend.push(now.getFullYear() & 0xFF);
        dataToSend.push((now.getFullYear() >> 8) & 0xFF);
        dataToSend.push(now.getMonth() + 1);
        dataToSend.push(now.getDate());
        dataToSend.push(now.getHours());
        dataToSend.push(now.getMinutes());
        dataToSend.push(now.getSeconds());

        // Calculate this weird unique thing we have to send in order for the device to accept our date.
        const checkSum =
            ('i'.charCodeAt(0) ^ systemId[0]) +
            ('L'.charCodeAt(0) ^ systemId[1]) +
            ('o'.charCodeAt(0) ^ systemId[2]) +
            ('g'.charCodeAt(0) ^ systemId[5]) +
            ('i'.charCodeAt(0) ^ systemId[6]) +
            ('c'.charCodeAt(0) ^ systemId[7]);
        dataToSend.push(checkSum & 0xFF);
        dataToSend.push((checkSum >> 8) & 0xFF);

        // var data = new Buffer([0x03, 0xdf, 0x07, 0x05, 0x1c, 0x16, 0x10, 0x2f, 0x8c, 0x03]);
        // Set the clock on the device
        bleController.writeCharacteristic(oortClockCharacteristic, dataToSend);
        console.log('[OORT] Successfully set the OORT clock.');
    }

    async _setOortState(peripheral, state) {
        await this._initializeOortSocket(peripheral);

        if(oortSensorCharacteristic == null) {
            throw 'No connected OORT. Cannot write.';
        }

        const val = (state) ? 0x1 : 0x0;

        bleController.writeCharacteristic(oortClockCharacteristic, [0x4, val]);
        console.log(`[OORT] sent state = ${state} to oort`);

        // ensure that you disconnect after controlling the smart socket
        setTimeout(() => {
            bleController.disconnectPeripheral(peripheral);
        }, 2000);
    }
}

module.exports = OortSocketHandler;