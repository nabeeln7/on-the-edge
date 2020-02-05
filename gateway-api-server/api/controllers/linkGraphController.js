const request = require('request-promise');
var Queue = require('queue-fifo');
const utils = require("../../../utils");
const discoveryModel = require('../model/discoveryModel');
var queue = new Queue();

/**
 * Generates the link graph by traversing through the entire gateway network one neighbor at a time.
 * For each neighbor
 * @param req express request object
 * @param res express response object
 * @returns {Promise<*>} linkGraph in json response format
 */
exports.getLinkGraphData = async function(req, res) {
	//pick up self's mac address (_id) and ip address from db
	const selfDetails = await discoveryModel.getSelfData();
	var neighborsDict = {};
	var dataDict = {};

	queue.enqueue({_id: selfDetails._id, IP_address: selfDetails.IP_address});

	while(!queue.isEmpty()) {
		const node = queue.dequeue();
		var neighborsOfNode = [];
		
		dataDict[node._id] = {"ip": node.IP_address};
		const neighbors = await getNeighborData(node.IP_address);

		neighbors.forEach(neighborNode => {
			const neighborId = neighborNode._id;
			neighborsOfNode.push(neighborId);
			if(!(Object.keys(neighborsDict).includes(neighborId))) {
				queue.enqueue(neighborNode)
			}
		});
		neighborsDict[node._id] = neighborsOfNode;
	}

	for(const entry of Object.entries(dataDict)) {
		const node = entry[0];
		const ip = entry[1].ip;

		dataDict[node]["sensors"] = await getSensorData(ip);
	}

	const linkGraph = {"graph": neighborsDict, "data": dataDict};
	return res.json(linkGraph);
};


/**
 * Uses the gateway API to query for the sensors connected to a given gateway
 * @param gatewayIP IP address of the gateway
 * @returns {Promise<any>}
 */
async function getSensorData(gatewayIP) {
	const execUrl = `http://${gatewayIP}:5000/sensors`;
	const body = await request({method: 'GET', uri: execUrl});
	return JSON.parse(body);
}

/**
 * Uses the gateway API to query for the neighbors of a given gateway
 * @param gatewayIP IP address of the gateway
 * @returns {Promise<any>} promise of a list of list of gateway_name and gateway_IP
 */
async function getNeighborData(gatewayIP) {
	const execUrl = `http://${gatewayIP}:5000/neighbors`;
	const body = await request({method: 'GET', uri: execUrl});
	return JSON.parse(body);
}

/**
 * Renders a vis.js based visualization for the link graph data. Uses a nunjucks template stored in templates/ for the
 * render.
 * @param req
 * @param res
 */
exports.renderLinkGraph = async function(req, res) {
	//pick up self's ip address from utils rather than self db collection to save a db lookup.
	const ipAddress = utils.getIPAddress();
	const data = {
		'ip_address': ipAddress
	};
	res.render('linkGraph.html', data);
};