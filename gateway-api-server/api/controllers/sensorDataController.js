const MongoClient = require('mongodb').MongoClient;

const mongo_url = 'mongodb://localhost:27017';
const dbName = 'discovery';
const sensor_discovery_collection = 'sensor_discovery';

exports.getSensors = async function(req, res) {
	//returns sensors active in the last 5minutes
	const client = await MongoClient.connect(mongo_url, { useNewUrlParser: true });
	const db = await client.db(dbName);
	const sensors = await db.collection(sensor_discovery_collection)
						.find({"ts": {$gt: Date.now() - 300000}})
						.project({"ts":0})
						.toArray();
	client.close();
	return res.json(sensors);
};