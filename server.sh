while :
do
    echo "Starting the server."
    sudo timeout 3600 /home/ubuntu/.nvm/versions/node/v21.6.0/bin/node server.js
    echo "Server stopped. Restarting shortly."
    sleep 1
done
