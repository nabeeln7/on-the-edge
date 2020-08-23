const request = require('request-promise');
const Queue = require('queue-fifo');
const utils = require("../../../utils/utils");
const daoHelper = require('../../../dao/dao-helper');
const queue = new Queue();

/**
 * Generates the link graph by traversing through the entire gateway network one neighbor at a time.
 * For each neighbor
 * @param req express request object
 * @param res express response object
 * @returns {Promise<*>} linkGraph in json response format
 */
exports.getLinkGraphData = async function(req, res) {
	const nodeDict = {};
	const neighborsDict = {};

	//pick up self's mac address (_id) and ip address from db
	const selfDetails = await daoHelper.selfDao.getLatestEntry();

	if(selfDetails !== null){
		queue.enqueue({id: selfDetails._id, ip: selfDetails.IP_address});
	}

	while(!queue.isEmpty()) {
		const node = queue.dequeue();
		const neighborsOfNode = [];

		//check if the node is reachable
		const nodeReachable = await isGatewayReachable(node.ip);
		if(nodeReachable) {
			//request for the neighbor data of a node is an API call made to that node's server
			const neighbors = await getNeighborData(node.ip);

			for(const neighborNode of neighbors) {
				const neighborId = neighborNode.id;
				const neighborIPAddress = neighborNode.ip;

				//check if the neighbor is reachable
				const neighborReachable = await isGatewayReachable(neighborIPAddress);
				if(neighborReachable) {
					neighborsOfNode.push(neighborId);

					//Check if this particular neighbor node is already traversed. All traversed nodes are added as keys
					//to the neighborsDict. So the keyset can be used to check if traversed or not.
					if(!(Object.keys(neighborsDict).includes(neighborId))) {
						queue.enqueue(neighborNode)
					}
				}
			}
			nodeDict[node.id] = {"ip": node.ip};
			neighborsDict[node.id] = neighborsOfNode;
		}
	}

	for(const entry of Object.entries(nodeDict)) {
		const node = entry[0];
		const ip = entry[1].ip;

		nodeDict[node]["devices"] = await getDevices(ip);
		nodeDict[node]["apps"] = await getApps(ip);
	}

	const linkGraph = {"graph": neighborsDict, "data": nodeDict};
	return res.json(linkGraph);
};

async function isGatewayReachable(gatewayIP) {
	const execUrl = `http://${gatewayIP}:5000/gateway/status`;
	try {
		const body = await request({method: 'GET', uri: execUrl, timeout: 5000});
		const statusData = JSON.parse(body);
		return statusData["status"];
	} catch(e) {
		return false;
	}
}

/**
 * Uses the gateway API to query for the devices connected to a given gateway
 * @param gatewayIP IP address of the gateway
 * @returns {Promise<any>}
 */
async function getDevices(gatewayIP) {
	const execUrl = `http://${gatewayIP}:5000/gateway/devices`;
	const body = await request({method: 'GET', uri: execUrl});
	return JSON.parse(body);
}

/**
 * Uses the gateway API to query for the apps running on a given gateway
 * @param gatewayIP IP address of the gateway
 * @returns {Promise<any>}
 */
async function getApps(gatewayIP) {
	const execUrl = `http://${gatewayIP}:5000/gateway/apps`;
	const body = await request({method: 'GET', uri: execUrl});
	return JSON.parse(body);
}

/**
 * Uses the gateway API to query for the neighbors of a given gateway
 * @param gatewayIP IP address of the gateway
 * @returns {Promise<any>} promise of a list of list of gateway_name and gateway_IP
 */
async function getNeighborData(gatewayIP) {
	const execUrl = `http://${gatewayIP}:5000/gateway/neighbors`;
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
	const ipAddress = utils.getGatewayIp();
	const data = {
		'ip_address': ipAddress
	};
	res.render('linkGraph.html', data);
};