while :
do
    echo "Starting the server."
    sudo timeout 3600 node --harmony-optional-chaining server.js
    echo "Server stopped. Restarting shortly."
    sleep 1
done
