const crypto = require('crypto');
const pcap = require('pcap');
const config = require('./config.json');

exports.getIPAddress =  function() {
	const networkInterface = config.network.interface;
	if(!networkInterface) {
		console.log("interface not found in config file");
	}

	//regex to exclude ipv6 addresses and only capture ipv4 addresses. This doesn't ensure that the ipv4 octets are 0-255 but this would suffice. All we need is to exclude ipv6 addresses. 
	const regex = /^\d+\.\d+\.\d+\.\d+$/;
	return pcap.findalldevs()
				.find(elem => elem.name === networkInterface)
				.addresses
				.find(addrElem => addrElem && regex.test(addrElem.addr))
				.addr;
};

const algorithm = 'aes-256-ctr';

exports.encryptAES = function(text, password, iv) {
	const cipher = crypto.createCipheriv(algorithm, password, iv);
	var encrypted = cipher.update(text, 'utf8', 'base64');
	encrypted += cipher.final('base64');
	return encrypted;
};

exports.decryptAES = function(encrypted, password, iv) {
	const decipher = crypto.createDecipheriv(algorithm, password, iv);
	var dec = decipher.update(encrypted, 'base64', 'utf8');
	dec += decipher.final('utf8');
	return dec;
};