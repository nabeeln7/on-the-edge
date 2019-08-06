#on-the-edge scripts
node $HOME/on-the-edge/gateway_app_server/server.js > $HOME/on-the-edge/logs/gw_app_server.log &
node $HOME/on-the-edge/gateway_code/gateway.js f > $HOME/on-the-edge/logs/gw_code.log &
node $HOME/on-the-edge/sensor_discover/discover.js &
node $HOME/on-the-edge/ble-peripheral-discovery/scan.js &

#lab11 gateway script
node $HOME/gateway/software/ble-gateway-mqtt/ble-gateway-mqtt.js &

#service-api
node $HOME/service-framework/http-api-server/server.js > $HOME/service-framework/logs/server.log &

#receive enocean packets
node $HOME/gateway/software/enocean-generic-gateway/enocean-generic-gateway.js &