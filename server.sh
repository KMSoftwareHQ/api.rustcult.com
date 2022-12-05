while :
do
    echo "Starting the server"
    sudo timeout 3600 /usr/local/n/versions/node/16.18.1/bin/node server.js
    echo "Server stopped. Restarting shortly."
    sleep 1
done
