var Request = require("request");
var noble = require("noble");
var bleno = require("bleno");
var fs = require('fs');
var aes_crypto = require("./aes_crypto");

register_url = process.argv[2];
ip_addr = process.argv[3];
params_file = "params.json";

ranging_key = "";
iv = "";

devices_in_proximity = {}

if(!register_url){
  console.log("Please provide register url");
  process.exit(1);
}

if(!ip_addr){
  console.log("Please provide ip address");
  process.exit(1);
}

// bleno.on('advertisingStart', function(error) {
//   console.log('[BLE Radio] Started AdvertisingStart: ' + (error ? 'error ' + error : 'success'));
// });

bleno.on('stateChange', handleBlenoStateChange);

noble.on('stateChange', handleNobleStateChange);

noble.on('discover', handleDiscoveredPeripheral);

function handleNobleStateChange(state) {
  if (state === 'poweredOn') {
    // console.log("noble state = powered on")
    noble.startScanning([], true);
    console.log("[BLE Radio] Started peripheral discovery")
  } else {
    // console.log("noble state = powered off")
    noble.stopScanning();
    // console.log("noble stopped scanning")
  }
}

function handleDiscoveredPeripheral(peripheral) {
  if (!peripheral.advertisement.manufacturerData) {
    console.log("[BLE Radio] Peripheral discovered: " + peripheral.address);
    
    const localName = peripheral.advertisement.localName;
    var data = localName.toString('utf8');
    console.log(`[BLE Radio] Received advertisement data = ${data}`);
    var discovered_ip = aes_crypto.decrypt(data, ranging_key, iv);
    console.log("[Ranging] Decrypted data = " + discovered_ip);
    if(isValidIPAddress(discovered_ip)) {
      console.log(`[Ranging] ${discovered_ip} is a valid IP address`);
      devices_in_proximity[peripheral.address] = [discovered_ip, Date.now()];
      console.log(`[Ranging] Peripherals discovered: ${JSON.stringify(devices_in_proximity, null, 4)}`);
    } else {
      console.log(`[Ranging] ${discovered_ip} is an invalid IP address`);
    }
  }
}

function isValidIPAddress(ipaddress) {  
  if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress)) {  
    return (true);  
  }  
  return (false);  
}

function loadKeyParams(callback) {
  if (!fs.existsSync(params_file)) {
    callback("")
  } else {
    fs.readFile(params_file, 'utf-8', function handleReadFile(err, data) {
      if (err) 
        throw err;
      key_params = JSON.parse(data);
      callback(key_params);
    });
  }
}

function registerWithServer(mac_address, user, pass) {
  var http_post_req_params = {
      "headers": { "content-type": "application/json" },
      "url": register_url,
      "body": JSON.stringify({
          "radioMACAddress": mac_address,
          "user": user,
          "pass": pass
      })
  };
  Request.post(http_post_req_params, handlePOSTResponse);
}

function handlePOSTResponse(error, response, body) {
  if(error) {
      return console.dir(error);
  }
  var key_params = JSON.parse(body);
  ranging_key = key_params.ranging_key;
  iv = key_params.iv;
  console.log(`[Ranging] Received ranging key from registration server. Key = ${ranging_key}, IV = ${iv}`);
  fs.writeFile(params_file,  JSON.stringify(key_params), 'utf-8', handleWriteFileError);
  //start advertising once we have the key
  startAdvertising();
}

function handleWriteFileError(err) {
  if (err) throw err;
}  

function handleBlenoStateChange(state) {
  if (state === 'poweredOn') {
    //console.log("bleno state = powered on");
    console.log("[BLE Radio] BLE MAC Address = " + bleno.address);
    loadKeyParams(handleKeyParams);
  } else if (state === 'poweredOff') {
    bleno.stopAdvertising();
    // console.log("bleno state = powered off");
  }
}

function startAdvertising() {
  
  encrypted_ip = aes_crypto.encrypt(ip_addr, ranging_key, iv);

  var advertisementData = new Buffer(31);
  advertisementData.writeUInt8(encrypted_ip.length + 1, 0); //length of the element (excluding the length byte itself). +1 is for length byte
  advertisementData.writeUInt8(0x09, 1); // AD type – specifies what data is included in the element. 0x16 => complete local name

  advertisementData.write(encrypted_ip, 2);

  bleno.startAdvertisingWithEIRData(advertisementData);

  console.log(`[BLE Radio] Started Advertising with encrypted data = ${encrypted_ip}`);
}

function handleKeyParams(key_params){
  if(!key_params) {
    mac_address = bleno.address;
    registerWithServer(mac_address, "admin", "pass");
  } else {
    ranging_key = key_params.ranging_key;
    iv = key_params.iv;
    console.log(`[Ranging] Reusing already obtained key = ${key_params.ranging_key}, IV = ${key_params.iv}`);
    startAdvertising();
  }
}