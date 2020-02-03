#on-the-edge scripts
node $HOME/on-the-edge/gateway-api-server/server.js > $HOME/on-the-edge/logs/gw_app_server.log 2>&1 &
DEBUG=gateway-scanner node $HOME/on-the-edge/gateway-scanner/gateway-scanner.js 2> $HOME/on-the-edge/logs/gw_code.log &
node $HOME/on-the-edge/mqtt-data-collector/mqtt-data-collector.js &
node $HOME/on-the-edge/ble-peripheral-scanner/ble-peripheral-scanner.js &

#lab11 gateway script
node $HOME/gateway/software/ble-gateway-mqtt/ble-gateway-mqtt.js &

#service-api
node $HOME/service-framework/http-api-server/server.js > $HOME/service-framework/logs/server.log 2>&1 &

#receive enocean packets
node $HOME/gateway/software/enocean-generic-gateway/enocean-generic-gateway.js &
